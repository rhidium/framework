import { Application } from 'typedoc';

/**
 * This script generates the documentation for the project
 * programmatically, instead of CLI-based.
 */
async function main() {
  // Application.bootstrap also exists, which will not load plugins
  // Also accepts an array of option readers if you want to disable
  // TypeDoc's tsconfig.json/package.json/typedoc.json option readers
  const app = await Application.bootstrapWithPlugins({
    entryPoints: ['src/index.namespaces.ts'],
    includeVersion: true,
  });

  // Project may not have converted correctly
  const project = await app.convert();
  if (project) {
    const outputDir = 'docs';

    // Rendered docs
    await app.generateDocs(project, outputDir);

    // Additionally, generate JSON output
    await app.generateJson(project, `${outputDir}/data.json`);
  } else {
    console.error('Failed to generate docs, exiting...');
    process.exit(1);
  }
}

main().catch(console.error);
