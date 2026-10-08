import type { CapacitorConfig } from '@capacitor/cli';
const config: CapacitorConfig = {
  appId: 'kr.wolgye.chongchong', appName: '총총월계길', webDir: 'dist',
  server: { hostname: 'localhost', androidScheme: 'https' },
  android: { allowMixedContent: false },
  loggingBehavior: 'debug',
};
export default config;
