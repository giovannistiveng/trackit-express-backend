// @ts-check
/**
 * Reglas equivalentes al perfil "Sonar way" de SonarQube para TypeScript que no trae
 * eslint-plugin-sonarjs. Así el lint local avisa lo mismo que el análisis de Sonar.
 * La clave Sonar va al lado de cada regla. Mismo archivo en el frontend.
 */
export const reglasSonarWay = {
  // Promesas, tipos y nulos
  '@typescript-eslint/prefer-promise-reject-errors': 'error', // S6671
  '@typescript-eslint/only-throw-error': 'error', // S3696
  '@typescript-eslint/prefer-nullish-coalescing': ['error', { ignorePrimitives: { string: true, boolean: true } }], // S6606
  '@typescript-eslint/prefer-optional-chain': 'error', // S6582
  '@typescript-eslint/no-unnecessary-type-assertion': 'error', // S4325
  '@typescript-eslint/no-redundant-type-constituents': 'error', // S6571
  '@typescript-eslint/no-duplicate-type-constituents': 'error', // S4621
  '@typescript-eslint/no-base-to-string': 'error', // S6551
  '@typescript-eslint/prefer-regexp-exec': 'error', // S6594
  '@typescript-eslint/prefer-string-starts-ends-with': 'error', // S6557
  '@typescript-eslint/prefer-for-of': 'error', // S4138
  '@typescript-eslint/prefer-readonly': 'error', // S2933
  '@typescript-eslint/prefer-function-type': 'error', // S6598
  '@typescript-eslint/no-inferrable-types': 'off',
  '@typescript-eslint/no-unnecessary-boolean-literal-compare': 'error', // S1125
  '@typescript-eslint/no-mixed-enums': 'error', // S6583
  '@typescript-eslint/prefer-reduce-type-parameter': 'off',
  // Familia S77xx (código moderno de JavaScript)
  'unicorn/prefer-node-protocol': 'error', // S7772
  'unicorn/prefer-global-this': 'error', // S7764
  'unicorn/prefer-string-replace-all': 'error', // S7781
  'unicorn/prefer-at': 'error', // S7755
  'unicorn/prefer-code-point': 'error', // S7758
  'unicorn/prefer-number-properties': 'error', // S7773
  'unicorn/throw-new-error': 'error', // S7723
  'unicorn/no-zero-fractions': 'error', // S7748
  'unicorn/no-negated-condition': 'error', // S7735
  'unicorn/prefer-export-from': ['error', { ignoreUsedVariables: true }], // S7763
  'unicorn/prefer-structured-clone': 'error', // S7784
  'unicorn/prefer-string-raw': 'error', // S7780
  'unicorn/prefer-single-call': 'error', // S7778
  'unicorn/no-useless-spread': 'error', // S7744
  'unicorn/prefer-includes': 'error', // S7765
  'unicorn/prefer-dom-node-dataset': 'error', // S7761
  'unicorn/prefer-dom-node-remove': 'error', // S7762
  'unicorn/prefer-dom-node-append': 'error', // S7746
  'unicorn/prefer-modern-dom-apis': 'error', // S7727
  'unicorn/prefer-query-selector': 'error', // S7754
  'unicorn/prefer-add-event-listener': 'error', // S7760
  'unicorn/prefer-math-min-max': 'error', // S7766
  'unicorn/prefer-math-trunc': 'error', // S7767
  'unicorn/prefer-top-level-await': 'off',
  'unicorn/no-instanceof-builtins': 'error', // S7733
  'unicorn/prefer-type-error': 'error', // S7786
  'unicorn/no-typeof-undefined': 'error', // S7741
  'unicorn/prefer-array-flat-map': 'error', // S7770
  'unicorn/prefer-array-some': 'error', // S7754
  'unicorn/prefer-array-find': 'error', // S7750
  'unicorn/prefer-array-index-of': 'error', // S7753
  'unicorn/prefer-set-has': 'error', // S7776
  'unicorn/no-lonely-if': 'error', // S7737
  'unicorn/prefer-logical-operator-over-ternary': 'error', // S7737
  'unicorn/prefer-default-parameters': 'error',
  'unicorn/no-useless-undefined': 'off',
};
