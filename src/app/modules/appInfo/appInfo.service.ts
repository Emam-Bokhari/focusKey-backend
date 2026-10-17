import path from 'path';

const getPrivacyPolicy = async () => {
  return path.join(__dirname, '..', 'htmlResponse', 'privacyPolicy.html');
};

const getAccountDelete = async () => {
  return path.join(__dirname, '..', 'htmlResponse', 'accountDelete.html');
};

const getSupport = async () => {
  return path.join(__dirname, '..', 'htmlResponse', 'support.html');
};

export const SettingsServices = {
  getPrivacyPolicy,
  getAccountDelete,
  getSupport,
};
