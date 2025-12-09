const fs = require('fs');
const crypto = require('crypto');
const { dataAuthPath } = require('../../cfg');
const { LocalUserBase, LanguageVariables, ApplicationSettings } = require('../../state');
const { hasInternetConnection, fetch } = require('../../utils/internetUtils');
const { SERVER_URL } = require('../../cfg');

class BaseAuth {
  static algorithm = 'aes-256-cbc';
  static secretKey = crypto.createHash('sha256').update('ftsa-fivz-mfiegw-wpp').digest();

  static encrypt(data) {
    try {
      if (!data) return null;

      const json = JSON.stringify(data);
      const iv = crypto.randomBytes(16);
      
      const cipher = crypto.createCipheriv(this.algorithm, this.secretKey, iv);
      
      const encrypted = Buffer.concat([cipher.update(json, 'utf8'), cipher.final()]);
      return Buffer.concat([iv, encrypted]).toString('hex');
    } catch (err) {
      console.error(`[AUTH] ${LanguageVariables.getMessage('ENCRYPTION_ERROR', 'errors', ApplicationSettings.settings.language)}:`, err.message);
      return null;
    }
  }

  static decrypt(encryptedHex) {
    try {
      if (!encryptedHex || typeof encryptedHex !== 'string') {
        console.error(`[AUTH] ${LanguageVariables.getMessage('DECRYPTION_ERROR', 'errors', ApplicationSettings.settings.language)}`);
        return null;
      }

      const buffer = Buffer.from(encryptedHex, 'hex');

      if (buffer.length < 16) {
        console.error(`[AUTH] ${LanguageVariables.getMessage('DECRYPTION_ERROR', 'errors', ApplicationSettings.settings.language)}`);
        return null;
      }

      const iv = buffer.slice(0, 16);
      const encrypted = buffer.slice(16);

      // Обращаемся к свойствам через this
      const decipher = crypto.createDecipheriv(this.algorithm, this.secretKey, iv);
      const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);

      const result = JSON.parse(decrypted.toString('utf8'));
      return result;
    } catch (err) {
      console.error(`[AUTH] ${LanguageVariables.getMessage('DECRYPTION_ERROR', 'errors', ApplicationSettings.settings.language)}:`, err.message);
      return null;
    }
  }

  /**
   * Сохранение данных в файл
   */
  static saveAuthData(data) {
    try {
      // Вызываем статический метод через this
      const encryptedData = this.encrypt(data);
      if (encryptedData) {
        fs.writeFileSync(dataAuthPath, encryptedData, 'utf8');
        console.log(`[AUTH] ${LanguageVariables.getMessage('AUTH_DATA_SAVED', 'success', ApplicationSettings.settings.language)}`);
      }
    } catch (err) {
      console.error(`[AUTH] ${LanguageVariables.getMessage('AUTH_DATA_SAVE_ERROR', 'errors', ApplicationSettings.settings.language)}:`, err.message);
    }
  }

  static loadAuthData() {
    try {
      if (!fs.existsSync(dataAuthPath)) {
        console.log(`[AUTH] ${LanguageVariables.getMessage('AUTH_DATA_LOAD_ERROR', 'errors', ApplicationSettings.settings.language)}`);
        return null;
      }

      const encryptedData = fs.readFileSync(dataAuthPath, 'utf8');
      return this.decrypt(encryptedData);
    } catch (err) {
      console.error(`[AUTH] ${LanguageVariables.getMessage('AUTH_DATA_LOAD_ERROR', 'errors', ApplicationSettings.settings.language)}:`, err.message);
      return null;
    }
  }

  static clearAuthData() {
    try {
      if (fs.existsSync(dataAuthPath)) {
        fs.unlinkSync(dataAuthPath);
        console.log(`[AUTH] ${LanguageVariables.getMessage('AUTH_DATA_SAVED', 'success', ApplicationSettings.settings.language)}`);
      }
    } catch (err) {
      console.error(`[AUTH] ${LanguageVariables.getMessage('AUTH_DATA_SAVE_ERROR', 'errors', ApplicationSettings.settings.language)}:`, err.message);
    }
  }

  static isValidAuthData(data) {
    return data && typeof data === 'object' && data.username && data.password;
  }
}

class Auth{
  static cookie = null;
  static _checkAuthInterval = null;

  static getCookie() {
    return this.cookie;
  }

  static async createAuthCheckInterval(intervalMs = 30000) {
    if (this._checkAuthInterval) {
      clearInterval(this._checkAuthInterval);
    }
    this._checkAuthInterval = setInterval(async () => {
      const isAuth = await this.checkAuthentication();
      if(!isAuth.isAuthenticated){
        console.log(`[AUTH] ${LanguageVariables.getMessage('AUTH_CHECK_FAILED', 'errors', ApplicationSettings.settings.language)}`);
        this.authenticate();
      }
    }, intervalMs);
  }

  static async forceAuthenticate(username, password){
    try {
      const internetConnection = await hasInternetConnection();

      const loginRes = await fetch(`${SERVER_URL}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({username, password}),
        timeout: 10000
      }).catch(err => {
        console.log(`[AUTH] ${LanguageVariables.getMessage('AUTH_NETWORK_ERROR', 'errors', ApplicationSettings.settings.language)}:`, err.message);
      });

      if(!loginRes.ok){
        const errorBody = await loginRes.text().catch(() => null);
        return { success: false, reason: `${LanguageVariables.getMessage('AUTH_SERVER_ERROR', 'errors', ApplicationSettings.settings.language)}: ${loginRes.status} ${loginRes.statusText} ${errorBody ? '- ' + errorBody : ''}` };
      }
      else{
        const authData = BaseAuth.encrypt({username: username, password: password}); 
        BaseAuth.saveAuthData(authData);
        Auth.authenticate();
        return { success: true };
      }
    }catch(err){
      console.error(`[AUTH] ${LanguageVariables.getMessage('AUTH_ERROR', 'errors', ApplicationSettings.settings.language)}:`, err.message);
      return { success: false, reason: `${LanguageVariables.getMessage('AUTH_ERROR', 'errors', ApplicationSettings.settings.language)}: ${err.message}` };
    }
  }

  static async authenticate() {
    try {
      this.createAuthCheckInterval();

      const internetConnection = await hasInternetConnection();
      const creds = BaseAuth.decrypt(BaseAuth.loadAuthData());

      if(!creds?.username || !creds?.password){
        console.log(`[AUTH] ${LanguageVariables.getMessage('AUTH_LOW_DATA', 'errors', ApplicationSettings.settings.language)}`);
        return { success: false, reason: LanguageVariables.getMessage('AUTH_LOW_DATA', 'errors', ApplicationSettings.settings.language) };
      }
      else if((creds?.username && creds?.password) && !internetConnection){
        console.log(`[AUTH] ${LanguageVariables.getMessage('AUTH_OFFLINE_MODE', 'errors', ApplicationSettings.settings.language)}`);
        LocalUserBase.setUserData({username: creds.username, id: -1, premium_until: null});
        return { success: true, reason: LanguageVariables.getMessage('AUTH_OFFLINE_MODE', 'errors', ApplicationSettings.settings.language) };
      }

      const loginRes = await fetch(`${SERVER_URL}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(creds),
        timeout: 10000
      }).catch(err => {
        console.log(`[AUTH] ${LanguageVariables.getMessage('AUTH_NETWORK_ERROR', 'errors', ApplicationSettings.settings.language)}:`, err.message);
      });

      if(!loginRes.ok){
        const errorBody = await loginRes.text().catch(() => null);
        return { success: false, reason: `${LanguageVariables.getMessage('AUTH_SERVER_ERROR', 'errors', ApplicationSettings.settings.language)}: ${loginRes.status} ${loginRes.statusText} ${errorBody ? '- ' + errorBody : ''}` };
      }

      const cookieHeader = loginRes.headers.get('set-cookie');
      this.cookie = Array.isArray(cookieHeader) ? cookieHeader[0] : cookieHeader;

      let data;
      
      try{
        data = await loginRes.json();
      }
      catch{
        return { success: false, reason: LanguageVariables.getMessage('AUTH_INCORRECT_SERVER_RESPONSE', 'errors', ApplicationSettings.settings.language) };
      }

      if(!data?.success){
        return { success: false, reason: LanguageVariables.getMessage('AUTHORIZATION_ERROR', 'errors', ApplicationSettings.settings.language) };
      }

      if (!data.user?.id || !data.user?.username) {
        return { success: false, reason: LanguageVariables.getMessage('AUTHORIZATION_ERROR', 'errors', ApplicationSettings.settings.language) };
      }

      LocalUserBase.setUserData({
        id: data.user.id,
        username: data.user.username,
        premium_until: data.user.premium_until || null
      });

      return {
        success: true,
      };
    }catch(err){
      console.error(`[AUTH] ${LanguageVariables.getMessage('AUTH_ERROR', 'errors', ApplicationSettings.settings.language)}:`, err.message);
      return { success: false, reason: `${LanguageVariables.getMessage('AUTH_ERROR', 'errors', ApplicationSettings.settings.language)}: ${err.message}` };
    }
  }

  static async checkAuthentication() {
      if (!this.cookie) {
          console.log(`[AUTH] ${LanguageVariables.getMessage('AUTH_NO_COOKIE', 'errors', ApplicationSettings.settings.language)}`);
          return { isAuthenticated: false, userData: null };
      }

      try {
          const response = await fetch(`${SERVER_URL}/auth/me`, {
              method: 'GET',
              headers: {
                  'Content-Type': 'application/json',
                  'Cookie': this.cookie 
              }
          });

          if (!response.ok) {
              const errorBody = await response.json().catch(() => null);

              if (response.status === 401 && errorBody?.error === "Не авторизован.") {
                  console.log(`[AUTH] ${LanguageVariables.getMessage('AUTH_INVALID_COOKIE', 'errors', ApplicationSettings.settings.language)}:`, errorBody.error);
                  return {
                      isAuthenticated: false,
                      userData: null,
                      reason: LanguageVariables.getMessage('AUTH_INVALID_COOKIE', 'errors', ApplicationSettings.settings.language)
                  };
              }

              console.log(`[AUTH] Unexpected status:`, response.status);
              return {
                  isAuthenticated: false,
                  userData: null,
                  reason: `${LanguageVariables.getMessage('AUTH_UNEXPECTED_SERVER_RESPONSE', 'errors', ApplicationSettings.settings.language)}: ${response.status}`
              };
          }

          const userData = await response.json();
          if (userData?.id && userData?.username) {
              LocalUserBase.setUserData({
                  id: userData.id,
                  username: userData.username,
                  premium_until: userData.premium_until || null
              });

              return { isAuthenticated: true, userData };
          }

          return { isAuthenticated: false, userData: null, reason: "Invalid user data" };

      } catch (err) {
          console.log(`[AUTH] NETWORK ERROR:`, err.message);
          return {
              isAuthenticated: false,
              userData: null,
              reason: `${LanguageVariables.getMessage('AUTH_NETWORK_ERROR', 'errors', ApplicationSettings.settings.language)}: ${err.message}`
          };
      }
  }
}

module.exports = { 
  BaseAuth,
  Auth
};