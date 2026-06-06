const path = require('path');
const {getDefaultConfig, mergeConfig} = require('@react-native/metro-config');

// Monorepo (pnpm workspaces): Metro must watch the repo root so it can resolve
// the hoisted `.pnpm` store and the `@nuru/shared` workspace package, and it must
// look up modules in both the package-local and the root node_modules.
const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

/** @type {import('metro-config').MetroConfig} */
const config = {
  watchFolders: [workspaceRoot],
  resolver: {
    nodeModulesPaths: [
      path.resolve(projectRoot, 'node_modules'),
      path.resolve(workspaceRoot, 'node_modules'),
    ],
    // pnpm symlinks every dep; let Metro traverse them.
    unstable_enableSymlinks: true,
    // The TS sources use NodeNext-style `.js` import specifiers that actually
    // point at `.ts`/`.tsx` files (tsc rewrites them, Metro doesn't). Map a
    // relative `*.js` import to its source file, falling back to the default.
    resolveRequest: (context, moduleName, platform) => {
      if (
        moduleName.endsWith('.js') &&
        (moduleName.startsWith('./') || moduleName.startsWith('../'))
      ) {
        try {
          return context.resolveRequest(context, moduleName.slice(0, -3), platform);
        } catch (_e) {
          // fall through to the default resolver below
        }
      }
      return context.resolveRequest(context, moduleName, platform);
    },
  },
};

module.exports = mergeConfig(getDefaultConfig(projectRoot), config);
