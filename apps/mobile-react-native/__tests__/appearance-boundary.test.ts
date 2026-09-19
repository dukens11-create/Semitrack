const fs = require('node:fs');
const path = require('node:path');
declare const __dirname: string;
const root = path.resolve(__dirname, '../src');
function sourceFiles(dir: string): string[] {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .flatMap((entry: { name: string; isDirectory: () => boolean }) =>
      entry.isDirectory()
        ? sourceFiles(path.join(dir, entry.name))
        : /\.tsx?$/.test(entry.name)
        ? [path.join(dir, entry.name)]
        : [],
    );
}
const files = sourceFiles(root).map(file => ({
  name: path.relative(root, file).replace(/\\/g, '/'),
  source: fs.readFileSync(file, 'utf8'),
}));
test('only the root resolver reads system appearance; screens never override it', () => {
  const reads = files.filter(file =>
    /useColorScheme\(|Appearance\.(getColorScheme|addChangeListener|setColorScheme)/.test(
      file.source,
    ),
  );
  expect(reads.map(file => file.name)).toEqual([
    'features/settings/DriverPreferences.tsx',
  ]);
  expect(
    files
      .filter(file => /<StatusBar\s/.test(file.source))
      .map(file => file.name),
  ).toEqual(['app/AppRoot.tsx']);
  expect(
    files.filter(file =>
      /import\s*\{[^}]*\bAlert\b[^}]*\}\s*from ['"]react-native['"]/.test(
        file.source,
      ),
    ),
  ).toEqual([]);
});
test('one runtime resolved theme provider, no nested screen appearance owners', () => {
  expect(
    files
      .filter(file => /<DriverAppearanceContext.Provider/.test(file.source))
      .map(file => file.name),
  ).toEqual(['features/settings/DriverPreferences.tsx']);
  expect(
    files
      .filter(file => /<DriverPreferences\s/.test(file.source))
      .map(file => file.name),
  ).toEqual(['features/settings/ApplicationAppearance.tsx']);
});

test('Android pre-hydration windows remain neutral and never force-dark the application', () => {
  const android = path.resolve(__dirname, '../android/app/src/main/res');
  for (const variant of ['values', 'values-v31']) {
    const xml = fs.readFileSync(
      path.join(android, variant, 'styles.xml'),
      'utf8',
    );
    expect(xml).toContain('<item name="android:forceDarkAllowed">false</item>');
  }
  const splash = fs.readFileSync(
    path.join(android, 'values-v31/styles.xml'),
    'utf8',
  );
  expect(splash).toContain(
    '<item name="android:windowSplashScreenBackground">#40464C</item>',
  );
  expect(
    fs.readFileSync(
      path.join(android, 'drawable/semitrax_launch_background.xml'),
      'utf8',
    ),
  ).toContain('#40464C');
});
