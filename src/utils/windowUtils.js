const path = require('path');

class WindowUtils{
    static win = null;

    static goToPage(page){
        if(this.win != null){
            this.win.loadFile(path.join(__dirname, 'public', ( '../../public' + page )));
        }
    }
}

module.exports = WindowUtils;