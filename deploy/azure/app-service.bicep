@description('Azure region for the Planned Out web app.')
param location string = resourceGroup().location

@description('Globally unique App Service name.')
param appName string

@description('App Service plan name.')
param planName string = '${appName}-plan'

@description('Linux App Service SKU. B1 is the lowest sensible always-on production web tier; use P1v3+ for heavier traffic.')
@allowed([
  'B1'
  'B2'
  'B3'
  'P1v3'
  'P2v3'
])
param skuName string = 'B1'

@secure()
@description('Supabase publishable anon key. This is public in the browser but kept as a parameter for repeatable deployment.')
param supabasePublishableKey string

@description('Supabase project URL.')
param supabaseUrl string = 'https://mllaiyqyabvbtyachxhh.supabase.co'

@description('Public application URL, for auth redirects and absolute links.')
param publicAppUrl string

@description('Existing Xavier AWS API URL for assistant text, including /xavier. Leave empty to fail closed.')
param xavierAwsApiUrl string = ''

@description('Optional production voice HTTPS endpoint ending in /tts. Leave empty until the cloud voice backend is verified.')
param xavierTtsUrl string = ''

@description('Exact trusted origin for XAVIER_TTS_URL. Leave empty until the voice backend is verified.')
param xavierTtsTrustedOrigin string = ''

@description('Optional public VAPID key for push notifications.')
param vapidPublicKey string = ''

resource plan 'Microsoft.Web/serverfarms@2023-12-01' = {
  name: planName
  location: location
  sku: {
    name: skuName
  }
  kind: 'linux'
  properties: {
    reserved: true
  }
}

resource app 'Microsoft.Web/sites@2023-12-01' = {
  name: appName
  location: location
  kind: 'app,linux'
  properties: {
    serverFarmId: plan.id
    httpsOnly: true
    siteConfig: {
      linuxFxVersion: 'NODE|22-lts'
      alwaysOn: true
      ftpsState: 'Disabled'
      minTlsVersion: '1.2'
      healthCheckPath: '/'
      appCommandLine: 'node server.js'
      appSettings: [
        { name: 'NODE_ENV', value: 'production' }
        { name: 'NEXT_TELEMETRY_DISABLED', value: '1' }
        { name: 'SCM_DO_BUILD_DURING_DEPLOYMENT', value: 'false' }
        { name: 'NEXT_PUBLIC_SUPABASE_URL', value: supabaseUrl }
        { name: 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', value: supabasePublishableKey }
        { name: 'NEXT_PUBLIC_APP_URL', value: publicAppUrl }
        { name: 'NEXT_PUBLIC_VAPID_PUBLIC_KEY', value: vapidPublicKey }
        { name: 'XAVIER_AWS_API_URL', value: xavierAwsApiUrl }
        { name: 'XAVIER_TTS_URL', value: xavierTtsUrl }
        { name: 'XAVIER_TTS_TRUSTED_ORIGIN', value: xavierTtsTrustedOrigin }
        { name: 'NEXT_PUBLIC_TTS_SERVER_URL', value: '' }
      ]
    }
  }
}

output defaultHostName string = app.properties.defaultHostName
output appUrl string = 'https://${app.properties.defaultHostName}'
