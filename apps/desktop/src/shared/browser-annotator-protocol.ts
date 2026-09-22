/**
 * Transport constant shared by the popover preload and main. Kept in its own
 * import-free module so the preload does not pull the Effect runtime into every
 * page just to learn a channel name.
 */
export const BROWSER_ANNOTATOR_CHANNEL = "desktop:browser:annotator";
