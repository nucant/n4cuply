// App settings. None of these are secrets: an OAuth Client ID is meant to be
// public, and the folder is Restricted, so its ID alone gives no access.
export const CONFIG = {
  appName: 'N4cuply',
  googleClientId: '633971369106-t22mm12eo275lbsbs5ie95m32q6or3d5.apps.googleusercontent.com',
  driveFolderId: '1rnGS1wM7Wv7ug9uwyYmjEnJMIkME0hWF',
  // Family server (server/worker.js): family members sign in here with a
  // username and password and play the admin's music through it.
  apiBase: 'https://n4cuply-api.nucant.workers.dev',
  // Signs in with Google and manages family members in admin.html.
  adminEmail: 'swarnadipchakraborty3@gmail.com',
};
