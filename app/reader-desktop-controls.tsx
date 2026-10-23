"use client";

import { useEffect } from "react";
import {
  createDefaultPlugin,
  setActionOpen,
  StatefulVisualSettingsContainer,
  useActionComponentStatus,
  useAppDispatch,
  useAppSelector,
} from "@edrlab/thorium-web/reader";
import type {
  StatefulActionContainerProps,
  ThPlugin,
} from "@edrlab/thorium-web/reader";

export default function ReaderDesktopControls() {
  const dispatch = useAppDispatch();
  const profile = useAppSelector((state) => state.reader.profile);
  const isLoading = useAppSelector((state) => state.reader.isLoading);
  const { isComponentAvailable: hasSettings } = useActionComponentStatus({
    actionKey: "settings",
  });
  const { isComponentAvailable: hasToc } = useActionComponentStatus({
    actionKey: "toc",
  });
  const isReady =
    (profile === "epub" || profile === "webPub") &&
    !isLoading &&
    hasSettings &&
    hasToc;

  useEffect(() => {
    const handleCommand = (event: Event) => {
      if (!isReady || !profile) return;
      const command: unknown = (event as CustomEvent<unknown>).detail;
      const key =
        command === "reading-settings"
          ? "settings"
          : command === "table-of-contents"
            ? "toc"
            : null;
      // Thorium 1.5.4 has no bookmark action; never invent a store key for it.
      if (key) dispatch(setActionOpen({ key, isOpen: true, profile }));
    };

    window.addEventListener("tls-reader-command", handleCommand);
    window.dispatchEvent(new CustomEvent("tls-reader-ready", { detail: isReady }));
    return () => {
      window.removeEventListener("tls-reader-command", handleCommand);
      window.dispatchEvent(new CustomEvent("tls-reader-ready", { detail: false }));
    };
  }, [dispatch, profile, isReady]);

  return null;
}

function DesktopSettingsTarget(props: StatefulActionContainerProps) {
  return (
    <>
      <ReaderDesktopControls />
      <StatefulVisualSettingsContainer {...props} />
    </>
  );
}

const HiddenDesktopTrigger = () => null;

export function createDesktopReaderPlugins(): ThPlugin[] {
  const plugin = createDefaultPlugin();
  const actions = plugin.components.actions!;
  return [
    {
      ...plugin,
      components: {
        ...plugin.components,
        actions: {
          ...actions,
          settings: {
            ...actions.settings,
            Trigger: HiddenDesktopTrigger,
            // Targets, unlike triggers, are not duplicated for toolbar measurement.
            // This also places the listener inside Thorium's own provider tree.
            Target: DesktopSettingsTarget,
          },
          toc: { ...actions.toc, Trigger: HiddenDesktopTrigger },
        },
      },
    },
  ];
}
