const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function loadControls({ profile = 'epub', isLoading = false, available = true, store, setActionOpen } = {}) {
  const window = new EventTarget();
  const effects = [];
  const actions = [];
  const ready = [];
  const settingsTarget = () => null;
  const tocTarget = () => null;
  const fullscreenTrigger = () => null;
  const jumpTrigger = () => null;
  const defaults = {
    id: 'core',
    components: {
      actions: {
        settings: { Trigger: () => null, Target: settingsTarget },
        toc: { Trigger: () => null, Target: tocTarget },
        fullscreen: { Trigger: fullscreenTrigger },
        jumpToPosition: { Trigger: jumpTrigger },
      },
      settings: { fontFamily: { Comp: () => null } },
    },
  };
  const thorium = {
    createDefaultPlugin: () => defaults,
    StatefulVisualSettingsContainer: settingsTarget,
    useAppDispatch: () => action => {
      actions.push(action);
      return store?.dispatch(action);
    },
    useAppSelector: select => select(store?.getState() ?? { reader: { profile, isLoading } }),
    useActionComponentStatus: () => ({ isComponentAvailable: available }),
    setActionOpen: setActionOpen ?? (payload => ({ type: 'actions/setActionOpen', payload })),
  };
  const jsx = (type, props) => ({ type, props });
  const filename = path.join(__dirname, '../app/reader-desktop-controls.tsx');
  const source = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(source, {
    module, exports: module.exports, window, CustomEvent,
    require: name => {
      if (name === 'react') return { useEffect: effect => effects.push(effect) };
      if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx, Fragment: 'fragment' };
      if (name === '@edrlab/thorium-web/reader') return thorium;
      throw new Error(`Unexpected dependency: ${name}`);
    },
  }, { filename });
  window.addEventListener('tls-reader-ready', event => ready.push(event.detail));
  return {
    ...module.exports, window, effects, actions, ready, defaults, settingsTarget, tocTarget,
    mount() {
      module.exports.default();
      const cleanups = effects.map(effect => effect());
      return () => cleanups.forEach(cleanup => cleanup?.());
    },
    command(detail) { window.dispatchEvent(new CustomEvent('tls-reader-command', { detail })); },
  };
}

test('desktop commands open the supported Thorium sheets for the current profile', () => {
  for (const profile of ['epub', 'webPub']) {
    const controls = loadControls({ profile });
    controls.mount();
    controls.command('reading-settings');
    controls.command('table-of-contents');
    assert.deepEqual(JSON.parse(JSON.stringify(controls.actions)), [
      { type: 'actions/setActionOpen', payload: { key: 'settings', isOpen: true, profile } },
      { type: 'actions/setActionOpen', payload: { key: 'toc', isOpen: true, profile } },
    ]);
    assert.deepEqual(controls.ready, [true]);
  }
});

test('bookmarks and malformed commands cannot dispatch unsupported store actions', () => {
  const controls = loadControls();
  controls.mount();
  for (const command of ['bookmarks', 'fullscreen', '__proto__', null, {}, 1]) {
    controls.command(command);
  }
  controls.window.dispatchEvent(new Event('tls-reader-command'));
  assert.equal(controls.actions.length, 0);
});

test('unmount removes the command listener and clears native readiness', () => {
  const controls = loadControls();
  const unmount = controls.mount();
  unmount();
  controls.command('reading-settings');
  assert.equal(controls.actions.length, 0);
  assert.deepEqual(controls.ready, [true, false]);
});

test('loading or unsupported reader profiles never advertise or execute commands', () => {
  for (const state of [
    { isLoading: true },
    { profile: null },
    { profile: 'audio' },
    { available: false },
  ]) {
    const controls = loadControls(state);
    const unmount = controls.mount();
    controls.command('reading-settings');
    assert.equal(controls.actions.length, 0);
    assert.deepEqual(controls.ready, [false]);
    unmount();
  }
});

test('desktop plugin hides only duplicate triggers without losing sheets or navigation', () => {
  const controls = loadControls();
  const [plugin] = controls.createDesktopReaderPlugins();
  const actions = plugin.components.actions;
  assert.equal(plugin.id, 'core');
  assert.equal(actions.settings.Trigger(), null);
  assert.equal(actions.toc.Trigger(), null);
  assert.equal(actions.toc.Target, controls.tocTarget);
  assert.equal(actions.fullscreen, controls.defaults.components.actions.fullscreen);
  assert.equal(actions.jumpToPosition, controls.defaults.components.actions.jumpToPosition);
  assert.equal(plugin.components.settings, controls.defaults.components.settings);
  assert.notEqual(actions.settings.Trigger, controls.defaults.components.actions.settings.Trigger);
  const target = actions.settings.Target({ triggerRef: { current: null } });
  const children = target.props.children;
  assert.equal(children[0].type, controls.default);
  assert.equal(children[1].type, controls.settingsTarget);
});

test('command events open actual Thorium reducer sheets without changing other profiles', async () => {
  const { actionsSlice, setActionOpen } =
    await import('@edrlab/thorium-web/core/lib');
  for (const profile of ['epub', 'webPub']) {
    let state = {
      reader: { profile, isLoading: false },
      actions: actionsSlice.reducer(undefined, { type: 'test/init' }),
    };
    // Exercise the real reducer without makeStore's browser persistence timer.
    const store = {
      getState: () => state,
      dispatch: action => {
        const actions = actionsSlice.reducer(state.actions, action);
        if (actions !== state.actions) state = { ...state, actions };
      },
    };
    const otherProfile = profile === 'epub' ? 'webPub' : 'epub';
    const otherBefore = store.getState().actions.keys[otherProfile];
    const controls = loadControls({ store, setActionOpen });
    const unmount = controls.mount();
    controls.command('reading-settings');
    assert.equal(store.getState().actions.keys[profile].settings.isOpen, true);
    controls.command('table-of-contents');
    assert.equal(store.getState().actions.keys[profile].toc.isOpen, true);
    assert.equal(store.getState().actions.keys[otherProfile], otherBefore);
    const beforeUnsupportedCommand = store.getState();
    controls.command('bookmarks');
    assert.equal(store.getState(), beforeUnsupportedCommand);
    unmount();
    store.dispatch(setActionOpen({ key: 'settings', isOpen: false, profile }));
    controls.command('reading-settings');
    assert.equal(store.getState().actions.keys[profile].settings.isOpen, false);
  }
});
