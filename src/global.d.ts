// Ambient declarations for CSS imports used by the Expo template's web target
// (theme.ts side-effect import of global.css; .module.css in *.web.tsx).
declare module '*.css';
declare module '*.module.css' {
  const classes: Record<string, string>;
  export default classes;
}
