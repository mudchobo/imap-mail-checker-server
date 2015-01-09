var Imap = require('imap');
var inspect = require('util').inspect;
var io = require('socket.io')(process.env.PORT || 8888);
var connections = {};
var NodeRSA = require('node-rsa');
var fs = require('fs');
var data = fs.readFileSync('./rsa_1024_priv', 'utf8');
var key = new NodeRSA(data);
console.log('start!');
io.set('pingTimeout', 3000);
io.set('transports', ['websocket', 'polling', 'xhr-polling']);
io.on('connection', function(socket) {
    console.log('connection = ' + socket.id);
    socket.emit('connection', {'connection': 'complete'});

    // 로그인 요청 시
    socket.on('login', function(data) {
        console.log('id = ' + data['id']);
        if (!data.hasOwnProperty('id') || !data.hasOwnProperty('pw') || !data.hasOwnProperty('imap_server') || !data.hasOwnProperty('imap_port') || !data.hasOwnProperty('imap_tls')) {
            socket.disconnect();
            return;
        }
        // 기존 imap이 있는지 확인 후 destroy.
        if (connections[socket.id] && connections[socket.id].imap) {
            connections[socket.id].imap.destroy();
            delete connections[socket.id].imap;
        }

        // 비밀번호 디코드.
        var pw = decrypt(data.pw);

        // imap 셋팅.
        var imap = new Imap({
            user: data.id,
            password: pw,
            host: data.imap_server,
            port: data.imap_port,
            tls: data.imap_tls
        });

        imap.once('ready', function() {
            connections[socket.id] = {socket: socket, imap: imap};
            socket.emit('login_success');
        });
        imap.on('error', function(err) {
            console.log('imap error');
            console.log(err);
            socket.emit('server_error', {msg: 'imap error!', err: err});
            socket.disconnect();
        });
        imap.on('end', function() {
            console.log('connection ended');
            socket.disconnect();
        });
        imap.connect();
    });

    // unseen목록 요청
    socket.on('unseen', function(data) {
        console.log('unseen = ' + socket.id);
        try {
            var imap = connections[socket.id].imap;
            imap.openBox('INBOX', true, function(err, box) {
                if (err) {
                    console.log(err);
                    socket.emit('server_error', {msg: 'inbox error!', err: err});
                    socket.disconnect();
                    return false;
                }
                imap.search(['UNSEEN', ['SINCE', 'May 20, 2010']], function(err, results) {
                    if (err) {
                        console.log(err);
                        socket.emit('server_error');
                        socket.disconnect();
                        return false;
                    }
                    socket.emit('unseen_result', {'unseen': results});
                });
            });
        } catch (e) {
            console.log('unseen error!');
            console.log(inspect(e));
            socket.emit('server_error', {msg: 'unseen error!', err: e});
            socket.disconnect();
        }
    });

    // 제목 가져오기.
    socket.on('mail_info', function(data) {
        if (!data.hasOwnProperty('id')) {
            socket.disconnect();
            return;
        }
        console.log('mail_info, socket.id = ' + socket.id + ', mail_id = ' + data.id);
        var mailId = data.id;
        try {
            var imap = connections[socket.id].imap;
            imap.openBox('INBOX', true, function(err, box) {
                if (err) {
                    console.log(err);
                    socket.emit('server_error', {msg: 'inbox error!', err: err});
                    socket.disconnect();
                    return false;
                }
                var f = imap.fetch([mailId], {bodies: ['HEADER.FIELDS (FROM SUBJECT)']});
                f.on('message', function(msg, seqno) {
                    msg.on('body', function(stream, info) {
                        var buffer = '';
                        stream.on('data', function(chunk) {
                            buffer += chunk.toString('utf8');
                        });
                        stream.once('end', function() {
                            header = Imap.parseHeader(buffer);
                            socket.emit('mail_info_result', {id: mailId, from: header.from[0], subject: header.subject[0]});
                        });
                    });
                });
            });
        } catch (e) {
            console.log('mail_info error!');
            console.log(inspect(e));
            socket.emit('server_error', {msg: 'main_info error!', err: e});
            socket.disconnect();
        }
    });

    // 연결 끊어짐.
    socket.on('disconnect', function() {
        console.log('disconnect = ' + socket.id);
        try {
            if (connections[socket.id] && connections[socket.id].imap) {
                connections[socket.id].imap.end();
                delete connections[socket.id].socket;
                delete connections[socket.id].imap;
                delete connections[socket.id];
            }
        } catch (e) {
            console.log('disconnect error!');
            console.log(inspect(e));
        }
    });
});

// 복호화
function decrypt(enc) {
    var result = '';
    try {
        result = new Buffer(key.decrypt(enc, 'base64'), 'base64').toString('ascii');
    } catch (e) {
        console.log('decrypt error!');
        console.log(inspect(e));
    }
    return result;
}
