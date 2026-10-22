// Version de l'application, inscrite à l'assemblage (esbuild) depuis package.json.
declare const __APP_VERSION__: string | undefined;

/** Version inscrite dans le fichier assemblé (null en développement et dans les tests). */
export const BUNDLED_VERSION: string | null = typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : null;

export const APP_VERSION: string = BUNDLED_VERSION ?? process.env.APP_VERSION ?? "0.0.0-dev";
