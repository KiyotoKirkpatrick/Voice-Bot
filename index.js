const fs = require('fs');
const Discord = require("discord.js");
const speech = require('@google-cloud/speech');
const ffmpeg = require('fluent-ffmpeg');
const tempfs = require('temp-fs');

var config = JSON.parse(fs.readFileSync("./settings.json", "utf-8"));

const WIT_API_KEY = config.wit_api_key;
const prefix = config.prefix;
const discord_token = config.discord_token;

const client = new Discord.Client();
const speechClient = new speech.SpeechClient({
  keyFilename: './google_creds.json'
});
var voiceChannel = null;
var textChannel = null;
var listenStreams = new Map();
var listening = false;


client.login(discord_token);

client.on('ready', handleReady.bind(this));

client.on('message', handleMessage.bind(this));

function handleReady() {
  console.log("I'm ready!");
}

function handleMessage(message) {
  if (!message.content.startsWith(prefix)) {
    return;
  }
  var command = message.content.toLowerCase().slice(1).split(' ')[0];

  switch (command) {
    case 'listen':
      textChannel = message.channel;
      commandListen(message);
      break;
    default:
      message.reply(" command not recognized! Type '!help' for a list of commands.");
  }
}

function handleSpeaking(member, speaking, receiver) {
  if (speaking) {
    const audioStream = receiver.createPCMStream(member);
    audioStreamToText(audioStream, (text) => {
      if (text != null) {
        textChannel.send(`**${member.username}:** ${text}`);
      }
    })
  }
}

function commandListen(message) {
  member = message.member;
  if (!member) {
    return;
  }
  if (!member.voiceChannel) {
    message.reply(" you need to be in a voice channel first.")
    return;
  }
  if (listening) {
    message.reply(" a voice channel is already being listened to!");
    return;
  }

  listening = true;
  voiceChannel = member.voiceChannel;
  textChannel.send('Listening in to **' + member.voiceChannel.name + '**!');

  voiceChannel.join().then((connection) => {
    connection.playFile('./beep.mp3')
    let receiver = connection.createReceiver();
    connection.on('speaking', (member, speaking) => {
      handleSpeaking(member, speaking, receiver)
    });
  }).catch(console.error);
}

function audioStreamToText(audioStream, cb) {
  tempfs.open({
    suffix: '.pcm'
  }, function (err, file) {
    if (err) { throw err; }
    audioStream.pipe(fs.createWriteStream(file.path))
    audioStream.on('end', () => {
      ffmpeg()
        .input(file.path)
        .inputFormat('s32le')
        .audioFrequency(16000)
        .audioChannels(1)
        .audioCodec('pcm_s16le')
        .format('s16le')
        .output(file.path)
        .on('error', function (err) {
          console.log('An error occurred: ' + err.message);
          file.unlink();
        })
        .on('end', function () {
          console.log('Parsing: ' + file.path)
          speechClient.recognize({
            audio: {
              content: fs.readFileSync(file.path).toString('base64')
            },
            config: {
              encoding: 'LINEAR16',
              sampleRateHertz: 16000,
              languageCode: 'es-ES',
            }
          })
            .then(data => {
              if (data.error) {
                console.log('An error occurred: ' + data.error.message);
              } else {
                console.log(data)
                if (data.results) cb(data.results[0].alternatives[0].transcript)
              }
              file.unlink();
            })
            .catch(err => {
              console.log('An error occurred: ', err);
              file.unlink();
            });
        })
        .run();
    })
  });
}
