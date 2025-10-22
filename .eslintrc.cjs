module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  parserOptions: { project: false, tsconfigRootDir: __dirname },
  env: { node: true, es2022: true },
  plugins: ['@typescript-eslint', 'prettier'],
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:prettier/recommended',
  ],
  rules: {
    'prettier/prettier': 'warn'
  },
  ignorePatterns: ['dist/**', 'node_modules/**']
};
