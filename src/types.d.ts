// extra global typings used in the demo
declare global {
  interface Window {
    ZynqOS_openWindow?: (title: string, content: any, appType?: string, initialPos?: { x: number; y: number }, initialWidth?: number, preserveId?: string, maximized?: boolean) => void;
    __TEXT_EDITOR_UI__?: any;
    __TERMINAL_UI__?: any;
    __CALC_UI__?: any;
    __FILE_BROWSER_UI__?: any;
    __MAPP_IMPORTER_UI__?: any;
    __STORE_UI__?: any;
    __WEDNESDAY_UI__?: any;
    __PYTHON_UI__?: any;
    __PHANTOMSURF_UI__?: any;
    __SETTINGS_UI__?: any;
    ZynqOS_startGoogleAuth?: () => void;
    ZynqOS_startGitHubAuth?: () => void;
    ZynqOS_openConsent?: () => void;
  }

  interface ImportMetaEnv {
    readonly VITE_GOOGLE_CLIENT_ID?: string
    readonly VITE_GITHUB_CLIENT_ID?: string
    readonly VITE_AUTH_REDIRECT_URI?: string
    readonly DEV?: boolean
  }

  interface ImportMeta {
    readonly env: ImportMetaEnv
  }
}
export {};
