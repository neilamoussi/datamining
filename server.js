/**
 * @typedef {Object.<string, Object.<string, {BPM: number, Key: string, Mode: boolean, Danceability: number, Valence: number, Energy: number, Acousticness: number, Instrumentalness: number, Liveness: number, Speechiness: number, positions: {date: Date, position: number}[]}>>} Data
 * @typedef {Object.<string, Object.<string, number[]>>} Positions
 * @typedef {Object.<string, Object.<string, number>>} Positionspic
 */

const fs = require('fs'), // File System library
	opn = require('opn'),
	PCA = require('pca-js'),
	{ DecisionTreeClassifier } = require('ml-cart'),
	MLR = require('ml-regression-multivariate-linear'),
	crossValidation = require('ml-cross-validation'),
	express = require('express'), // serveur
	app = express(), // serveur encore
	port = 8080; // port, à changer si conflit

//

function parseRaw(data) { // Parsing du .data: gestion des guillemets et préparation pour les caractères accentués
	let clean = '',
		string = false,
		escaped = false;
	for(let ch of data) {
		if(string) {
			if(escaped) {
				if(ch === 'u') {
					clean += '\\u';
				} else {
					clean += ch;
				}
				escaped = false;
				//}
			} else if(ch === '\\') {
				escaped = true;
			} else if(ch === '"') {
				string = true;
			} else {
				clean += ch;
			}
		} else if(ch === '"') {
			string = true;
		} else {
			clean += ch;
		}
	}

	return clean;
}

function remove13(buffer) { // Enlève les retours chariot (\r)
	let clean = [];
	for(let i of buffer)
		if(i !== 13)
			clean.push(i);

	return Buffer.from(clean);
}

function parseData() {
	const raw_playlists = parseRaw(remove13(fs.readFileSync('data/playlists.data')).toString()).split('\n');
	const raw_tracks = parseRaw(fs.readFileSync('data/tracks.data').toString()).split('\n');
	raw_playlists.pop(); // La dernière ligne est vide, il faut la supprimer
	raw_tracks.pop();

	/** @type {Object.<string, Object.<string, {BPM: number, Key: string, Mode: boolean, Danceability: number, Valence: number, Energy: number, Acousticness: number, Instrumentalness: number, Liveness: number, Speechiness: number, positions: {date: Date, position: number}[]}>>} */
	let data = {};
	/** @type {string[]} */
	let playlist_headers = raw_playlists[0].split('\t');
	/** @type {Object.<string, {BPM: number, Key: string, Mode: boolean, Danceability: number, Valence: number, Energy: number, Acousticness: number, Instrumentalness: number, Liveness: number, Speechiness: number}>} */
	let tracks = {};
	/** @type {string[]} */
	let tracks_headers = raw_tracks[0].split('\t');


	for(let i = 1; i < raw_tracks.length; i++) {
		let line = raw_tracks[i].split('\t');
		/** @type {{BPM: number, Key: string, Mode: boolean, Danceability: number, Valence: number, Energy: number, Acousticness: number, Instrumentalness: number, Liveness: number, Speechiness: number}} */
		let value = {};
		for(let j = 0; j < line.length; j++) {
			let column;
			switch(tracks_headers[j]) {
			case 'BPM': // on garde le BPM tel quel: un entier
				column = parseInt(line[j]);
				break;
			case 'Mode': // On met le mode en binaire: 1 pour major et 0 pour minor
				if(line[j] === 'Major')
					column = 1;
				else if(line[j] === 'Minor')
					column = 0;
				else
					column = null;
				break;
			case 'Danceability': // Toutes ces variables sont converties en pourcentages
			case 'Valence':
			case 'Energy':
			case 'Acousticness':
			case 'Instrumentalness':
			case 'Liveness':
			case 'Speechiness':
				column = parseInt(line[j]) / 100;
				break;
			default: // De base on laisse la variable sous forme de texte (la key par exemple)
				column = line[j];
			}
			if(tracks_headers[j] !== 'url')
				value[tracks_headers[j]] = column;
		}
		tracks[line[0]] = value;
	}

	for(let i = 1; i < raw_playlists.length; i++) {
		let line = raw_playlists[i].split('\t');

		let song = { // Déstructuration des objets
			title: line[1].replace(/\\u[0-9a-f]{4}/g, match => String.fromCharCode(parseInt(match.substring(2), 16))), // Convertir les caractères unicodes
			artists: line[2].replace(/\\u[0-9a-f]{4}/g, match => String.fromCharCode(parseInt(match.substring(2), 16))),
			...tracks[line[3]]
		};
		if(data.hasOwnProperty(line[5])) {
			if(data[line[5]].hasOwnProperty(line[3])) {
				data[line[5]][line[3]].positions.push({
					date: new Date(line[4]),
					position: parseInt(line[0])
				});
			} else {
				data[line[5]][line[3]] = {
					...song, // On passe tous les attributs de song à son parent
					positions: [{
						date: new Date(line[4]),
						position: parseInt(line[0])
					}]
				};
			}
		} else {
			data[line[5]] = {};
			data[line[5]][line[3]] = {
				...song,
				positions: [{
					date: new Date(line[4]),
					position: parseInt(line[0])
				}]
			};
		}
	}

	return data;
}

//

/**
 * @param {Data} data
 * @returns {Positions}
 */
function getPositions(data) {
	let positions = {};

	for(let [playlist, songs] of Object.entries(data)) {
		let _map = {};
		for(let [url, infos] of Object.entries(songs))
			_map[url] = infos.positions.map(pos => pos.position);
		positions[playlist] = _map;
	}

	return positions;
}

/**
 * 2.1 - 1er tiret
 * @param {Data} data 
 * @returns {Positionspic}
 */
function getPositionsPic(data) {
	let positionsPic = {};

	for(let [playlist, songs] of Object.entries(data)) { // Pour chaque playlist
		let positionsPicByPlaylist = {};
		for(let [song_url, song_data] of Object.entries(songs)) { // Pour chaque musique
			let bestPosition = Number.MAX_SAFE_INTEGER; // On initialise la position pic à un très grand nombre
			for(let positions of Object.values(song_data.positions)) // Pour toutes les positions
				if(positions.position < bestPosition) // Si on trouve une meilleure position, on modifie
					bestPosition = positions.position; 
			positionsPicByPlaylist[song_url] = bestPosition;
		}
		positionsPic[playlist] = positionsPicByPlaylist;
	}

	return positionsPic;
}

/**
 * 2.1 - 1er tiret
 * @param {Data} data 
 */
function addPositionPic(data) {
	for(let [playlist, songs] of Object.entries(data)) { // Pour chaque playlist
		for(let [song_url, song_data] of Object.entries(songs)) { // Pour chaque musique
			let bestPosition = Number.MAX_SAFE_INTEGER; // On initialise la position pic à un très grand nombre
			for(let positions of Object.values(song_data.positions)) // Pour toutes les positions
				if(positions.position < bestPosition) // Si on trouve une meilleure position, on modifie
					bestPosition = positions.position;
			data[playlist][song_url].positionPic = bestPosition;
		}
	}
}

/**
 * Indicateur binaire n°1 2.1, 2ème tiret
 */
function getIsTop15(positionsPic) {
	let isTop15 = {};
	for(let [playlist, songsUrl] of Object.entries(positionsPic)) { // Pour chaque playlist
		let isTop15PlaylistRelativ = {};
		for(let [songsURL, positionPic] of Object.entries(songsUrl)) { // Pour chaque chanson
			isTop15PlaylistRelativ[songsURL] = (positionPic < 15);
		}
		isTop15[playlist] = isTop15PlaylistRelativ;
	}

	return isTop15;
}

/**
 * 
 * @param {Data} data 
 */
function addVariables(data) {
	for(let [playlist_name, songs] of Object.entries(data)) { // Pour chaque playlist
		for(let [song_url, song_data] of Object.entries(songs)) { // Pour chaque musique
			let bestPosition = Number.MAX_SAFE_INTEGER; // On initialise la position pic à un très grand nombre

			data[playlist_name][song_url].playlistDuration = 0; // Durée de la chanson dans la playlist
			data[playlist_name][song_url].playlistMeanPos = 0; // Position moyenne de la chanson dans la playlist

			for(let positions of Object.values(song_data.positions)) { // Pour toutes les positions
				if(positions.position < bestPosition) // Si on trouve une meilleure position, on modifie
					bestPosition = positions.position;
				
				data[playlist_name][song_url].playlistDuration++;
				data[playlist_name][song_url].playlistMeanPos += positions.position;
			}
			data[playlist_name][song_url].positionPic = bestPosition; // Meilleure position de la chanson dans la playlist
			data[playlist_name][song_url].posPicInf15 = bestPosition < 15; // La chanson a-t'elle une position pic < 15 ?
			data[playlist_name][song_url].playlistMeanPos /= Object.keys(song_data.positions).length;
			data[playlist_name][song_url].playlistMeanPosInf15 = data[playlist_name][song_url].playlistMeanPos < 15; // La position moyenne de la chanson est-elle < 15 ?
		}
	}
}

/**
 * 2.1 3ème tiret
 * Temps pendant lequel la chanson est apparu dans la playlist en nombre de semaine
 * Data est un object js pouvant être envisagé comme une Map avec pour clé une string (le nom de la playlist), et comme valeur une map
 * avec comme clé une sting (l'url de la chanson) et comme value un object avec divers attributs comme le titre, le Liveness, la liste
 * ses positions...
 * @param {Data} data
 */
function getTimeAppeared(data) {
	let timeAppeared = {};

	for(let [playlist_name, songs] of Object.entries(data)) { // Pour chaque playlist
		let times_playlistSpecific = {};
		for(let [song_url, song_data] of Object.entries(songs)) { // Pour chaque chanson
			times_playlistSpecific[song_url] = song_data.positions.length; // song_data.positions est la liste des positions de la chanson au fil du temps
		}
		timeAppeared[playlist_name] = times_playlistSpecific;
	}

	return timeAppeared;
}

/**
 * 2.1 4ème tiret
 * Position moyenne de la chanson pendant qu'elle était dans la playlist
 * Data est un object js pouvant être envisagé comme une Map avec pour clé une string (le nom de la playlist), et comme valeur une map
 * avec comme clé une sting (l'url de la chanson) et comme value un object avec divers attributs comme le titre, le Liveness, la liste
 * ses positions...
 * @param {Object} positions
 */
function getMeanPositions(positions) {
	let meanPositions = {};

	for(let [playlist_name, song] of Object.entries(positions)) {
		let myMap;
		if(meanPositions.hasOwnProperty(playlist_name)) {
			myMap = meanPositions[playlist_name];
		} else {
			myMap = {};
			meanPositions[playlist_name] = myMap;
		}
		
		for(let [url, pos_array] of Object.entries(song)) {
			let mean = pos_array.reduce((a, b) => a + b);
			mean /= pos_array.length;
			myMap[url] = mean; // La moyenne des positions ?
		}
	}

	return meanPositions;
}

/**
 * Indication de si la chanson a une position moyenne infèrieure à 15.
 * Le paramètre est un object pouvant être vu comme une map avec comme key
 * le nom de la playlist et comme value une map avec comme key l'url de la
 * chanson et comme valeur la position moyenne. C'est ce qui nous est renvoyé
 * par la fonction getMeanPosition
 * @param {Data} data
 * Prend positions en paramètres
 */
function getMeanPosInf15(meanPos) {
	let meanPosInf15 = {};

	for(let [playlist_name, song] of Object.entries(meanPos)) {
		let meanPosInf15_playlistSpecific = {};
		for( let [song_url, mean] of Object.entries(song)) {
			meanPosInf15_playlistSpecific[song_url] = (mean < 15);
		}
		meanPosInf15[playlist_name] = meanPosInf15_playlistSpecific;
	}
	
	return meanPosInf15;
}

/**
 * 
 * @param {Data} data 
 */
function addColumns(data) {
	let d2 = {};
	for(let [playlist, songs] of Object.entries(data)) {
		d2[playlist] = {};
		for(let [url, infos] of Object.entries(songs)) {
			d2[playlist][url] = {};
			for(let [variable, valeur] of Object.entries(infos))
				d2[playlist][url][variable] = valeur;
			for(let i of ['A', 'A#', 'B', 'C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#']) {
				if(infos.Key === i)
					d2[playlist][url][i] = 1;
				else
					d2[playlist][url][i] = 0;
			}
		}
	}

	return d2;
}

/**
 * 
 * @param {Data} data 
 * @param {*} stats 
 */
function normalize(data, stats) {
	let d2 = {};
	for(let [playlist, songs] of Object.entries(data)) {
		d2[playlist] = {};
		for(let [url, infos] of Object.entries(songs)) {
			d2[playlist][url] = {};
			for(let variable of Object.keys(infos)) {
				if(['BPM', 'A', 'A#', 'B', 'C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'Mode', 'Danceability', 'Valence', 'Energy', 'Acousticness', 'Instrumentalness', 'Liveness', 'Speechiness'].includes(variable)) {
					d2[playlist][url][variable] = (data[playlist][url][variable] - stats[playlist][variable].mean) / stats[playlist][variable].standardDeviation;
				}
			}
		}
	}

	return d2;
}

/**
 * 
 * @param {Data} data 
 */
function getStats(data) { // Obtenir la moyenne, la variance et l'écart-type
	let stats = {};
	
	for(let [playlist, songs] of Object.entries(data)) {
		stats[playlist] = {};
		for(let infos of Object.values(songs)) {
			for(let [variable, valeur] of Object.entries(infos)) {
				if(['BPM', 'A', 'A#', 'B', 'C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'Mode', 'Danceability', 'Valence', 'Energy', 'Acousticness', 'Instrumentalness', 'Liveness', 'Speechiness'].includes(variable)) {
					if(stats[playlist].hasOwnProperty(variable)) {
						stats[playlist][variable].mean += valeur; // Somme de tous les éléments
					} else {
						stats[playlist][variable] = {
							mean: valeur,
							variance: 0
						};
					}
				}
			}
		}
	}
	for(let [playlist, st] of Object.entries(stats)) { // Diviser la somme par le nombre d'éléments (la moyenne quoi)
		for(let variable of Object.keys(st)) {
			stats[playlist][variable].mean /= Object.keys(data[playlist]).length;
		}
	}

	for(let [playlist, songs] of Object.entries(data)) {
		for(let infos of Object.values(songs)) {
			for(let [variable, valeur] of Object.entries(infos)) {
				if(['BPM', 'A', 'A#', 'B', 'C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'Mode', 'Danceability', 'Valence', 'Energy', 'Acousticness', 'Instrumentalness', 'Liveness', 'Speechiness'].includes(variable)) {
					stats[playlist][variable].variance += Math.pow(valeur - stats[playlist][variable].mean, 2); // Variance
				}
			}
		}
	}
	for(let [playlist, st] of Object.entries(stats)) {
		for(let variable of Object.keys(st)) {
			stats[playlist][variable].variance /= Object.keys(data[playlist]).length;
			stats[playlist][variable].standardDeviation = Math.sqrt(stats[playlist][variable].variance); // Ecart-type = sqrt(variance)
		}
	}

	return stats;
}

/**
 * 
 * @param {Data} data
 */
function getMeanMusics(data) {
	let music = {};
	let keyMax = {};
	let stats = getStats(data);

	for(let [playlist, st] of Object.entries(stats)) {
		music[playlist] = {};
		keyMax[playlist] = {
			nom: '',
			valeur: 0
		};
		for(let variable of Object.keys(st)) {
			if(['A', 'A#', 'B', 'C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#'].includes(variable)) {
				if(stats[playlist][variable].mean > keyMax[playlist].valeur) {
					keyMax[playlist] = {
						nom: variable,
						valeur: stats[playlist][variable].mean
					};
				}
			}
			music[playlist][variable] = stats[playlist][variable].mean;
		}
	}

	for(let playlist of Object.keys(stats))
		music[playlist].Key = keyMax[playlist].nom;

	return music;
}

function euclidianDistance(m1, m2) {
	let sum = 0;
	for(let i of ['BPM', 'A', 'A#', 'B', 'C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'Mode', 'Danceability', 'Valence', 'Energy', 'Acousticness', 'Instrumentalness', 'Liveness', 'Speechiness'])
		sum += Math.pow(m1[i] - m2[i], 2);
	return Math.sqrt(sum);
}

/**
 * 
 * @param {Array} m
 */
function euclidianDistanceNormalized(m) {
	let sum = 0;

	for(let i of ['BPM', 'A', 'A#', 'B', 'C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'Mode', 'Danceability', 'Valence', 'Energy', 'Acousticness', 'Instrumentalness', 'Liveness', 'Speechiness'])
		sum += m[i] * m[i];

	return Math.sqrt(sum);
}

/**
 * 
 * @param {Data} data Données normalisées
 * @param {number} k
 */
function kClosestMusicsWithNormalisedData(data, k) {
	let sortedData = {};

	for(let [playlist, songs] of Object.entries(data)) {
		sortedData[playlist] = Object.entries(songs).map(([url, infos]) => ({
			url: url,
			distance: euclidianDistanceNormalized(infos)
		})).sort((e1, e2) => e1.distance - e2.distance);
	}
	
	return Object.entries(sortedData).map(([playlist, songs]) => ({[playlist]: songs.slice(0, k)})).reduce((x, t) => {
		Object.entries(x).forEach(([a, b]) => t[a] = b);
		return t;
	}, {});
}

/**
 * 2.2 - Analyse Exploratoire - 3ème tiret
 * Renvoie les url des chansons ayant la meilleure position moyenne pour chaque playlist.
 * Le paramètre est un object pouvant être vu comme une map avec comme key
 * le nom de la playlist et comme value une map avec comme key l'url de la
 * chanson et comme valeur la position moyenne. C'est ce qui nous est renvoyé
 * par la fonction getMeanPosition
 * @param {Object} data
 * Prend meanPositions en paramètre
 */
function getBestMeanPositionSong(meanPos) {
	let bestMeanPositionSong = {};

	for(let [playlist_name, song] of Object.entries(meanPos)) {
		let currentMean = Object.keys(song).length;
		let currentURL = '';
		for(let [song_url, mean] of Object.entries(song)) {
			if(mean < currentMean) {
				currentMean = mean;
				currentURL = song_url;
			}
		}
		bestMeanPositionSong[playlist_name] = {url : currentURL, mean : currentMean};
	}
	
	return bestMeanPositionSong;
}


/**
 * 2.2 - Analyse Exploratoire - 4ème tiret
 * Renvoie la liste des positions de la chanson song dans la playlist playlist avec leur timestamp associés
 * @param {*} data
 * @param {string} song
 * @param {string} playlist_name
 */
function getSongEvolution(data, song, playlist_name) {
	return Object.values(data[playlist_name][song].positions); // Nous retournons la liste des positions associées à la playlist et à la musique demandée
}

/**
 * 
 * @param {Array} a
 * @param {Array} b
 */
function shuffle(a, b) {
	for(let i = a.length - 1; i > 0; i--) {
		const j = Math.floor(Math.random() * (i + 1));
		[a[i], a[j]] = [a[j], a[i]];
		[b[i], b[j]] = [b[j], b[i]];
	}
}

//

/**
 * Coupe les données pour l'entrainement
 * @param {Data} data
 * @param {function(Object, string)} column
 */
function splitData(data, column) {
	column = column || (()=>{});
	let dataset = [];
	let predictions = [];
	Object.entries(data).forEach(([name, playlist]) => {
		for(let song of Object.values(playlist)) {
			let u = [];
			for(let [variable, valeur] of Object.entries(song))
				if(['BPM', /*'A', 'A#', 'B', 'C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#',*/ 'Mode', 'Danceability', 'Valence', 'Energy', 'Acousticness', 'Instrumentalness', 'Liveness', 'Speechiness'].includes(variable))
					u.push(valeur);
			dataset.push(u);
			predictions.push(column(song, name));
		}
	});
	shuffle(dataset, predictions); // Mélange du tableau

	let separator = Math.floor(4 * dataset.length / 5); // 80% entrainement, 20% test

	return {
		dataset, // le dataset sans la variable à prédire
		predictions, // la variable à prédire
		trainingSet: dataset.slice(0, separator), // 80% du dataset sans la variable à prédire
		trainingPrediction: predictions.slice(0, separator), // 80% de la variable à prédire associée à la variable précédente
		testSet: dataset.slice(separator), // même chose mais à 20%
		testPrediction: predictions.slice(separator)
	};
}

function acp() {
	let { dataset } = splitData(data, (_, name) => names.indexOf(name));

	let vectors = PCA.getEigenVectors(dataset);

	return PCA.computeAdjustedData(dataset, vectors[0], vectors[1]).adjustedData; // On récupère les 2 variables ayant le plus d'influence
}

// let topTwo = PCA.computePercentageExplained(vectors, vectors[1]);

// 2.4.1
function predictPlaylist() { // Decision Tree Classifier
	let { trainingSet, trainingPrediction, testSet, testPrediction } = splitData(data, (_, name) => names.indexOf(name));

	let classifier = new DecisionTreeClassifier();
	classifier.train(trainingSet, trainingPrediction);
	let result = classifier.predict(testSet);

	let g = 0;
	for(let i = 0; i < result.length; i++)
		if(result[i] === testPrediction[i])
			g++; // Nombre d'éléments correctement prédits

	return {
		headers: ['BPM', 'Mode', 'Danceability', 'Valence', 'Energy', 'Acousticness', 'Instrumentalness', 'Liveness', 'Speechiness'],
		tree: classifier.root,
		accuracy: g / testPrediction.length
	};
}


function crossVal() { // Validation croisée par arbre de décision
	let { dataset, predictions } = splitData(data, (_, name) => names.indexOf(name));

	let confusionMarix = crossValidation.kFold(DecisionTreeClassifier, dataset, predictions, {}, 5);
	for(let i = 0; i < names.length; i++)
		console.log(names[i], confusionMarix.getConfusionTable(i));
	console.log('accuracy:', confusionMarix.getAccuracy());
	console.log(confusionMarix);
}


// 2.4.2
function linearRegression() { // Effectue une régression linéaire sur la durée de la chanson dans la playlist
	// Découpe du dataset
	let { trainingSet, trainingPrediction, testSet, testPrediction } = splitData(data, d => [d.playlistDuration]);

	// Création de la fonction de régression (régression multi-linéaire)
	let regressor = new MLR(trainingSet, trainingPrediction);
	// Prédiction sur le jeu de test
	let result = regressor.predict(testSet);
	// console.log(regressor.weights);

	// Moyenne en y
	let ybar = 0;
	for(let [i] of testPrediction)
		ybar += i;
	ybar /= testPrediction.length;

	// Calcul de r2
	let num = 0, den = 0;
	for(let i = 0; i < result.length; i++) {
		num += Math.pow(testPrediction[i][0] - result[i][0], 2);
		den += Math.pow(testPrediction[i][0] - ybar, 2);
	}
	let r2 = 1 - num / den;

	return { weights: regressor.weights, r2 };
}



let data = parseData();

addVariables(data); // Ajoute les variables relatives à la position
let positions = getPositions(data); // Liste des positions de chaque chanson
let positionsPic = getPositionsPic(data); // Meilleures positions de chaque chanson
let isTop15 = getIsTop15(positionsPic); // La position maximale est-elle < 15 ?
let timeAppeared = getTimeAppeared(data); // Durée pendant laquelle chaque chanson apparait dans la playlist
let meanPositions = getMeanPositions(positions); // Position moyenne de chaque chanson dans la playlist
let meanPosInf15 = getMeanPosInf15(meanPositions); // La position moyenen est-elle < 15 ?

let dataExtended = addColumns(data); // Découpe du mode en variables binaires
let stats = getStats(dataExtended); // Moyenne, variance, écart-type. Utile pour la normalisation
let normalized = normalize(dataExtended, stats); // ...
let closest = kClosestMusicsWithNormalisedData(normalized, 5); // Renvoie les k musiques les plus proches de la moyenne

let meanMusicsPerPlaylist = getMeanMusics(dataExtended); // Calule la musique moyenne pour chaque playlist
let bestMeanPositionSong = getBestMeanPositionSong(meanPositions); // Récupère la musique la plus proche de la moyenne pour chaque playlist
// let songEvolution = getSongEvolution(data, 'https://www.spotontrack.com/track/my-own-summer-shove-it/18052', 'metal');


let names = Object.keys(dataExtended);


/* Fonctions pour le serveur */

app.use(express.static('public'));

app.get('/data.json', (req, res) => {
	res.setHeader('Content-Type', 'application/json');
	res.end(JSON.stringify(data));
});


// 2_1_1
app.get('/getPositionsPic', (req, res) => {
	res.setHeader('Content-Type', 'application/json');
	// let positionsPic = getPositionsPic(data);
	res.end(JSON.stringify(positionsPic));
});

// 2_1_2
app.get('/getIsTop15', (req, res) => {
	res.setHeader('Content-Type', 'application/json');
	// let positionsPic = getPositionsPic(data);
	// let isTop15 = getIsTop15(positionsPic);
	res.end(JSON.stringify(isTop15));
});

// 2_1_3
app.get('/getTimeAppeared', (req, res) => {
	res.setHeader('Content-Type', 'application/json');
	// let timeAppeared = getTimeAppeared(data);
	res.end(JSON.stringify(timeAppeared));
});

// 2_1_4
app.get('/getMeanPositions', (req, res) => {
	res.setHeader('Content-Type', 'application/json');
	// let positions = getPositions(data);
	// let meanPositions = getMeanPositions(positions);
	res.end(JSON.stringify(meanPositions));
});

// 2_1_5
app.get('/getMeanPosInf15', (req, res) => {
	res.setHeader('Content-Type', 'application/json');
	// let positions = getPositions(data);
	// let meanPositions = getMeanPositions(positions);
	// let isTop15 = getMeanPosInf15(meanPositions);
	res.end(JSON.stringify(meanPosInf15));
});


// 2_2_2
app.get('/getMeanMusics', (req, res) => {
	res.setHeader('Content-Type', 'application/json');
	// let meanMusics = getMeanMusics(data2);
	res.end(JSON.stringify(meanMusicsPerPlaylist));
});
app.get('/kClosestMusicsWithNormalisedData', (req, res) => {
	res.setHeader('Content-Type', 'application/json');
	// let data2 = addColumns(data);
	// let stats = getStats(data2);
	// let normalized = normalize(data2, stats);
	// let meanMusics = getMeanMusics(data2);
	// let closest = kClosestMusicsWithNormalisedData(normalized, 5);
	res.end(JSON.stringify(closest));
});

// 2_2_3
app.get('/getBestMeanPositionSong', (req, res) => {
	res.setHeader('Content-Type', 'application/json');
	// let positions = getPositions(data);
	// let meanPositions = getMeanPositions(positions);
	// let bestMeanPositionSong = getBestMeanPositionSong(meanPositions);
	res.end(JSON.stringify(bestMeanPositionSong));
});

// 2_2_4
app.get('/getSongEvolution', (req, res) => {
	res.setHeader('Content-Type', 'application/json');

	let chosenSong = req.header('song');
	let chosenPlaylist = req.header('playlist');
	let chosenSongEvolution = getSongEvolution(data, chosenSong, chosenPlaylist);
	res.end(JSON.stringify(chosenSongEvolution));
});

app.get('/adjustedData', (req, res) => {
	res.setHeader('Content-Type', 'application/json');
	res.end(JSON.stringify(acp()));
});

// 2_4_1
app.get('/predictPlaylist', (req, res) => {
	res.setHeader('Content-Type', 'application/json');
	let predictedPlaylist = predictPlaylist();
	console.log('Predicted : ');
	console.log(predictedPlaylist);
	res.end(JSON.stringify(predictedPlaylist));
});

// 2_4_2
app.get('/linearRegression', (req, res) => {
	res.setHeader('Content-Type', 'application/json');
	res.end(JSON.stringify(linearRegression()));
});

/* Function for the notebook */
app.get('/contentFile', (req, res) => {
	res.setHeader('Content-Type', 'application/json');

	let fileName = req.header('fileName');
	let fileContent = fs.readFileSync(fileName).toString();
	res.end(JSON.stringify(fileContent));
});

app.listen(port, () => {
	console.log(`Connectez vous sur http://localhost:${port}/ pour pouvoir exécuter les fonctions`);
	opn(`http://localhost:${port}`);
});
