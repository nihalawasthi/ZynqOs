// extra global typings used in the demo
declare global {
  interface Window {
    ZynqOS_openWindow?: (title: string, content: any) => void;
    __TEXT_EDITOR_UI__?: any;
    __TERMINAL_UI__?: any;
    __CALC_UI__?: any;
    __FILE_BROWSER_UI__?: any;
    __MAPP_IMPORTER_UI__?: any;
  }
}
export {};
