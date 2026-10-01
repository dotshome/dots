// Copy to firebase-config.js to mirror the world to your own Firebase project (Realtime Database).
// The page reads this when it is not served from localhost; the server also needs a service-account
// key at server/firebase-key.json. Without either, everything runs locally and nothing is published.
export default {
  apiKey: 'your-web-api-key',
  authDomain: 'your-project.firebaseapp.com',
  databaseURL: 'https://your-project-default-rtdb.firebaseio.com',
  projectId: 'your-project',
  appId: 'your-app-id',
};
