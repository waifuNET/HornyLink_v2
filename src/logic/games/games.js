const { GameCollection, LanguageVariables, ApplicationSettings } = require('../../state');
const { Auth } = require('../auth/auth');
const { fetch } = require('../../utils/internetUtils');
const globalUtils = require('../../utils/globalUtils');

const URLS = {
    myLibrary: 'https://api.hornylink.ru/library/', // ?lang=ru
    comments: 'https://api.hornylink.ru/comments/comment/' // получение идет по id игры /1 && language=ru
}

class Games {
    static async Init(){
        await this.updateGames();
    }

    static async updateGames(){
        try{
            const response = await fetch(URLS.myLibrary + globalUtils.getLangParamForContent(), {
                headers: { 'Cookie': Auth.getCookie() }
            });

            const data = await response.json();

            if(!Array.isArray(data)){
                console.warn(`[GAMES] ${LanguageVariables.getMessage('INCURRECT_SERVER_ANSWER', 'errors')}`);
            }

            await Promise.all(data.map(async (game) => {
                game.size = null;
                game.lastPlayDate = null;
                game.playtime = (game.playtime / 60).toFixed(1);
                game.isInstalled = null;
                GameCollection.updateGame(game.id, game);
                return game;
            }));

            console.log(`[GAMES] Обновлено: ${data.length} игр.`);
        }
        catch (err) {
            console.warn(`[GAMES] ${LanguageVariables.getMessage('UPDATE_GAME_LIST', 'errors')}`, err);
        }
    }

    static async loadComments(gameId){
        try{
            const response = await fetch(URLS.comments + gameId + globalUtils.getLangParamForContent(), {
                headers: { 'Cookie': Auth.getCookie() }
            });

            const data = await response.json();

            if(!Array.isArray(data)){
                console.warn(`[GAMES] ${LanguageVariables.getMessage('INCURRECT_SERVER_ANSWER', 'errors')}`);
                return [];
            }

            // Удаляем старые комментарии этой игры
            GameCollection.deleteCommentsByGameId(gameId);

            // Добавляем новые комментарии
            data.forEach(comment => {
                GameCollection.addComment(comment);
            });

            console.log(`[GAMES] Загружено ${data.length} комментариев для игры ${gameId}.`);
            
            return data;
        }
        catch (err) {
            console.warn(`[GAMES] Ошибка загрузки комментариев для игры ${gameId}:`, err);
            return [];
        }
    }

    static getGameComments(gameId){
        return GameCollection.getCommentsByGameId(gameId);
    }
}

module.exports = Games;