import nx from '@nx/eslint-plugin';

export default [
  ...nx.configs['flat/base'],
  ...nx.configs['flat/typescript'],
  ...nx.configs['flat/javascript'],
  {
    ignores: ['**/dist', '**/out-tsc'],
  },
  {
    files: ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx'],
    rules: {
      '@nx/enforce-module-boundaries': [
        'error',
        {
          enforceBuildableLibDependency: true,
          allow: ['^.*/eslint(\\.base)?\\.config\\.[cm]?[jt]s$',
            '^@app/.*$',
            '^@env/.*$',
          ],

          depConstraints: [
            // Domain must be pure and depend only on itself
            {
              sourceTag: 'type:domain',
              onlyDependOnLibsWithTags: ['type:domain'],
              bannedExternalImports: ['*'],
            },

            // Default: everything else can depend on everything
            {
              sourceTag: '*',
              onlyDependOnLibsWithTags: ['*'],
            },
          ],
        },
      ],
    },
  },
  // =========================
  // Global TypeScript rules
  // =========================
  {
    files: [
      '**/*.ts',
      '**/*.tsx',
      '**/*.cts',
      '**/*.mts',
      '**/*.js',
      '**/*.jsx',
      '**/*.cjs',
      '**/*.mjs',
    ],
    // Override or add rules here
    rules: {
      // ---------------------------------
      // Nx architectural boundaries
      // ---------------------------------
      '@nx/enforce-module-boundaries': [
        'error',
        {
          enforceBuildableLibDependency: true,
          allow: [],
          depConstraints: [
            {
              sourceTag: 'type:domain',
              onlyDependOnLibsWithTags: []
            },
            {
              sourceTag: 'type:data-access',
              onlyDependOnLibsWithTags: ['type:domain']
            },
            {
              sourceTag: 'type:feature',
              onlyDependOnLibsWithTags: [
                'type:data-access',
                'type:domain',
                'type:shared'
              ]
            },
            {
              sourceTag: 'type:app',
              onlyDependOnLibsWithTags: [
                'type:feature',
                'type:data-access',
                'type:domain',
                'type:shared'
              ]
            }
          ]
        }
      ],

      // ---------------------------------
      // MQTT-Align vocabulary enforcement
      // ---------------------------------
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'alert',
              message:
                '`alert` is not a MQTT-Align domain concept. Use Notification instead.'
            },
            {
              name: 'alerts',
              message:
                '`alerts` are intentionally not part of MQTT-Align. Use Notification.'
            }
          ],
          patterns: [
            {
              group: ['**/*signal*', '**/*signals*'],
              message:
                '`signal` is reserved for Angular framework usage only. Do not use it as a MQTT-Align domain or architectural term.'
            }
          ]
        }
      ]
    }
  }
];
