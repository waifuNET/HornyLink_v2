const { ApplicationSettings } = require('../state');

class globalUtils{
    static getLangParamForContent(){
        return `?lang=${ApplicationSettings.settings.content_language}`;
    }
    static getLangParamForComments(){
        return `?lang=${ApplicationSettings.settings.comments_language}`;
    }
}

module.exports = globalUtils;