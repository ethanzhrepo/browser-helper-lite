declare const __ENABLE_CDP_DRIVER__: boolean;
declare const __AUTO_UPDATE_CHECK__: boolean;

/** Whether this build declares the `debugger` permission (see wxt.config.ts). */
export const ENABLE_CDP_DRIVER: boolean = __ENABLE_CDP_DRIVER__;

/** Whether this build looks for new releases by itself. Off in test builds, which must not use the network. */
export const AUTO_UPDATE_CHECK: boolean = __AUTO_UPDATE_CHECK__;
