const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');

const DIST_DIR = path.join(__dirname, 'dist');

// Define files to copy
const FILES_TO_COPY = [
  'manifest.json',
  'index.html',
  'LICENSE',
  'README.md'
];

// Define folders to copy
const FOLDERS_TO_COPY = [
  'icons',
  'src/lib'
];

async function copyFolderRecursive(src, dest) {
  if (!fs.existsSync(dest)) {
    fs.mkdirSync(dest, { recursive: true });
  }
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      await copyFolderRecursive(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

async function build() {
  console.log('Starting build...');

  // 1. Clean and create dist directory
  if (fs.existsSync(DIST_DIR)) {
    fs.rmSync(DIST_DIR, { recursive: true, force: true });
  }
  fs.mkdirSync(DIST_DIR, { recursive: true });

  // 2. Run esbuild for app.js
  console.log('Bundling src/js/app.js...');
  await esbuild.build({
    entryPoints: ['src/js/app.js'],
    bundle: true,
    minify: true,
    target: ['es2020'],
    format: 'esm',
    outfile: 'dist/src/js/app.js',
  });

  // 3. Run esbuild for background.js
  console.log('Bundling background.js...');
  await esbuild.build({
    entryPoints: ['background.js'],
    bundle: true,
    minify: true,
    target: ['es2020'],
    outfile: 'dist/background.js',
  });

  // 4. Run esbuild for styles.css
  console.log('Bundling styles.css...');
  await esbuild.build({
    entryPoints: ['styles.css'],
    bundle: true,
    minify: true,
    outfile: 'dist/styles.css',
  });

  // 5. Copy required files
  console.log('Copying static files...');
  for (const file of FILES_TO_COPY) {
    if (fs.existsSync(file)) {
      fs.copyFileSync(file, path.join(DIST_DIR, file));
    }
  }

  // 6. Copy required folders
  console.log('Copying static folders...');
  for (const folder of FOLDERS_TO_COPY) {
    const srcFolder = path.join(__dirname, folder);
    const destFolder = path.join(DIST_DIR, folder);
    if (fs.existsSync(srcFolder)) {
      await copyFolderRecursive(srcFolder, destFolder);
    }
  }

  // 7. Special case: if there are other assets or folders, copy them too. Wait, what about src/assets or src/models?
  // Let's check if src/assets exists
  const assetsFolder = path.join(__dirname, 'src/assets');
  if (fs.existsSync(assetsFolder)) {
    await copyFolderRecursive(assetsFolder, path.join(DIST_DIR, 'src/assets'));
  }

  console.log('Build complete! Distribution ready in /dist');
}

build().catch((err) => {
  console.error('Build failed:', err);
  process.exit(1);
});
