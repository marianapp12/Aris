import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'node',
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    pool: 'forks',
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'json-summary'],
      reportsDirectory: './coverage',
      /** Solo módulos con suite Vitest; el resto de `src/` queda fuera para un % interpretable. */
      include: [
        'src/utils/userNameGenerator.ts',
        'src/utils/adQueueScriptMessages.ts',
        'src/services/apiClient.ts',
      ],
    },
  },
});
