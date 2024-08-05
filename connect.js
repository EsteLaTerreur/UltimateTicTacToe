var http = require('http');
var fs = require('fs');
var express = require('express');
var app = express();
var server = http.createServer(app);
var static_pages = require('serve-static');
var io = require('socket.io')(server);
var session = require('express-session');
var path = require('path');
const { log } = require('console');
const { connected } = require('process');
const { CLIENT_RENEG_WINDOW } = require('tls');

// Authentification
var users = JSON.parse(fs.readFileSync('users.json'));
var www_auth = {'WWW-Authenticate': 'Basic realm="Zone à accès restreint"'};
var send401 = function(res) { 
    res.writeHead(401, www_auth); 
    res.end('Mot de passe ou nom incorrect');
};

function basic_auth(req, res, next) {
    var auth = require('basic-auth');
    var credentials = auth(req);

    if (!credentials) {
        send401(res);
    } else {
        var authenticated = false;
        users.users.forEach(function(user) {
            if (credentials.name === user.username && credentials.pass === user.password) {
                authenticated = true;
            }
        });
        if (!authenticated) {
            setTimeout(send401, 3000, res);
        } else {
            next();
        }
    }
}

// Middleware authentification
app.use(basic_auth);
app.use('/reset', function(req, res) { 
    send401(res); 
});

// Serveur statique
app.use(static_pages('htdocs'));
app.use(function(request, response) {
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf8' });
    response.end('Désolé, le document demandé est introuvable...');
});

// Route pour la page du jeu
app.get('/Jeu', basic_auth, function(req, res) {
    res.sendFile(path.join(__dirname, 'htdocs/pageDuJeu.html'));
});

// Route pour la page d'accueil
app.get('/', basic_auth, function(req, res) {
    res.sendFile(path.join(__dirname, 'htdocs/index.html'));
});
// Route pour la page d'accueil
app.get('/index', basic_auth, function(req, res) {
    res.sendFile(path.join(__dirname, 'htdocs/index.html'));
});

// const liste_users = users.users;
var nomJoueur1 = "";
var nomJoueur2 = "";
var tourDuJoueur = nomJoueur1;

//scores 
var scores = JSON.parse(fs.readFileSync('scores.json'));
var liste_participants = scores.participants;
liste_participants.sort((a, b) => b.score - a.score);
var majscore = false;

// gestion de la connexion + chat + jeu + score
io.sockets.on('connection', (socket) => {
    console.log("Nouvelle requête")
    // enregistrement des noms
    socket.on('enregistre_nom', (data) => {
        nom = data.name;
        if(nomJoueur1==""&&nomJoueur2!=nom){ // joueur 1 n'a pas de nom
            nomJoueur1 = nom;
            tourDuJoueur = nomJoueur1;
        }else if(nomJoueur1!=nom&&nomJoueur2==""){ // le nom n'a pas déjà été pris
            nomJoueur2 = nom;
        } else {
            msg = "Veuillez choisir un autre nom."
            socket.emit('2_noms_pareils',{msg : msg});
        }
    });
    // envoie des msg à tous les utilisateurs connectés
    socket.on('chat message', (data) => {
        console.log(data.user + " dit : " + data.msg);
        io.emit('chat message', { message : data.msg, sender: data.user} ); 
    });

    // récupère nom du joueur qui vient de jouer et envoie une update du plateau si c'est à lui
    // et un msg d'erreur sinon 
    socket.on('à qui le tour ?',(data) =>{
        if(nomJoueur1=="" || nomJoueur2==""){
            msg = "Veillez à ce que les 2 joueurs aient défini leur nom avant de jouer.";
            socket.emit('message_nom_erreur',{msg : msg});
        } else if(tourDuJoueur==data.user && nomJoueur2!=undefined){ // c'est son tour
            if(tourDuJoueur==nomJoueur1){ 
                io.emit('updatePlateau',{case : data.case, symbole : "croix"})
                console.log('envoie socket');
                tourDuJoueur=nomJoueur2
            } else if(tourDuJoueur==nomJoueur2) {
                io.emit('updatePlateau',{case : data.case, symbole : "rond"})
                tourDuJoueur=nomJoueur1
                io.emit('msg')
            } else {// les noms n'ont pas été définis
                console.log('erreur');
                msg = "Veillez à ce que les 2 joueurs aient défini leur nom avant de jouer.";
                io.emit('message_nom_erreur',{message : msg})
            }
        }  else{ // ce n'est pas son tour
            msg = "C'est au tour de "+ tourDuJoueur + " de jouer."
            socket.emit('message_nom_erreur',{msg : msg});
        }
    })

    // gestion score 
    // envoie le score actuel
    socket.on('demande_score',(data) =>{
        scores = JSON.parse(fs.readFileSync('scores.json'));
        liste_participants = scores.participants;
        liste_participants.sort((a, b) => b.score - a.score);
        var liste_users = [];
        var liste_scores = [];
        liste_participants.sort((a, b) => b.score - a.score);
        for (let user of liste_participants) {
            liste_users.push(user.username)
            liste_scores.push(user.score)
        }
        io.emit('envoi_score',{liste_users : liste_users, liste_scores : liste_scores})
    })
    // acualise le score après une victoire et modifie fichier
    socket.on('actualise_score', (data) => {
        var nomGagnant ;
        var nomPerdant;
        if(tourDuJoueur==nomJoueur1){
            nomGagnant = nomJoueur2;
        }else{
            nomGagnant = nomJoueur1;
        }
    
        // Lire les données du fichier JSON
        var scores = JSON.parse(fs.readFileSync('scores.json'));
        var liste_participants = scores.participants;
        var nouveauJoueurGagnant = liste_participants.find(player => player.username === nomGagnant);
        var joueur = data.joueur;
        if (nouveauJoueurGagnant && data.partieGagnee && !majscore) { // si le joueur existe déjà dans la liste
            nouveauJoueurGagnant.score +=1;
            majscore = true;
        } else if(!(nouveauJoueurGagnant) && nomGagnant !="" && data.partieGagnee&&!majscore){ // si le joueur n'existe pas dans la liste
            var nouveauJoueur = {
                username: nomGagnant,
                score: 0.5
            };
            liste_participants.push(nouveauJoueur);
            majscore = true;
        }
        liste_participants.sort((a, b) => b.score - a.score);
        fs.writeFileSync('scores.json', JSON.stringify(scores, null, 2));
        var liste_users = [];
        var liste_scores = [];
        for (let user of liste_participants) {
            liste_users.push(user.username);
            liste_scores.push(user.score);
        }
        io.emit('envoi_score', { liste_users: liste_users, liste_scores: liste_scores });
    });
    socket.on('msg victoire',(data)=>{
        var nomGagnant ;
        if(tourDuJoueur==nomJoueur1){
            nomGagnant = nomJoueur2;
        }else{
            nomGagnant = nomJoueur1;
        }
        var msg = "Le joueur "+nomGagnant+" a gagné !"
        io.emit('msg victoire',{msg : msg});
    })
    socket.on('reload',(data)=>{
        nomJoueur1 = "";
        nomJoueur2 = "";
        tourDuJoueur = nomJoueur1;
        majscore = false;
        io.emit('reload');
    })
});


// Démarrage du serveur
server.listen(8080);
console.log("Le serveur est disponible à l'adresse : http://localhost:8080/");

