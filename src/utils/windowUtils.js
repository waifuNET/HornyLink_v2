const path = require('path');

class WindowUtils{
    static win = null;

    static goToPage(page, _win = null){
        if(_win != null){
            _win.loadFile(path.join(__dirname, 'public', ( '../../public' + page )));
            return;
        }
        if(this.win != null){
            this.win.loadFile(path.join(__dirname, 'public', ( '../../public' + page )));
            return;
        }
    }
}

module.exports = WindowUtils;