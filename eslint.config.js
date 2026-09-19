// Flat config (ESLint 9). Se hereda de la raíz para todo el monorepo:
// no hay un .eslintrc por workspace, las reglas se deciden una vez aquí.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    // Bloque solo-ignores: aplica a toda la ejecución, no solo a este objeto.
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/.turbo/**',
      // Tipos generados desde el contrato OpenAPI: se regeneran, no se revisan
      // ni se corrigen a mano, así que tampoco se lintan.
      '**/*.gen.ts',
    ],
  },
  {
    files: ['**/*.{ts,tsx}'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    rules: {
      // La base la desactiva ya tseslint (eslint-recommended), pero la dejamos
      // explícita por si algún día se lintan .js con estas mismas reglas.
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          // Mismo idioma que noUnusedLocals/noUnusedParameters de tsconfig.base:
          // el prefijo "_" marca "no usado a propósito".
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
          destructuredArrayIgnorePattern: '^_',
          args: 'after-used',
          caughtErrors: 'all',
          ignoreRestSiblings: true,
        },
      ],
    },
  },
);
