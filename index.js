const fs = require('fs')
const Discord = require("discord.js")
const speech = require('@google-cloud/speech')
const ffmpeg = require('fluent-ffmpeg')
const tempfs = require('temp-fs')
const Stream = require("stream")

var discordKeys = JSON.parse(fs.readFileSync("./keys/discord-keys.json", "utf-8"))

const prefix = discordKeys.prefix
const discord_token = discordKeys.discord_token

const client = new Discord.Client()
const speechClient = new speech.SpeechClient({
  keyFilename: './keys/google-keys.json'
})
const voiceConnections = new Map()
const guildLangs = new Map()

function defaultCatcher(err) {
  if (err.code === 50013) return false // Missing permissions: Not our problem
  console.debug(err)
}

client.login(discord_token)
console.log(`Voice-Bot: Logging in to discord!`)
client.on('ready', () => {
  console.log(`Logged in as ${client.user.tag} serving to ${client.guilds.array().length} servers`)
})
client.on('message', handleMessage.bind(this))



function handleMessage(message) {
  if (!message.content.startsWith(prefix)) {
    return
  }
  const parsedMsg = message.content.slice(prefix.length).split(' ')
  const command = parsedMsg[0].toLowerCase()

  switch (command) {
    case 'listen':
      commandListen(message)
      break
    case 'stop':
      destroyConnection(message.member.guild.id)
      break
    case 'lang':
      if (parsedMsg[1]) {
        // validLangList = Array.from($('.devsite-table-wrapper tr td:nth-child(2)')).map(val => val.innerHTML).join(',')
        // in https://cloud.google.com/speech/docs/languages
        var validLangList = "af-ZA,am-ET,hy-AM,az-AZ,id-ID,ms-MY,bn-BD,bn-IN,ca-ES,cs-CZ,da-DK,de-DE,en-AU,en-CA,en-GH,en-GB,en-IN,en-IE,en-KE,en-NZ,en-NG,en-PH,en-ZA,en-TZ,en-US,es-AR,es-BO,es-CL,es-CO,es-CR,es-EC,es-SV,es-ES,es-US,es-GT,es-HN,es-MX,es-NI,es-PA,es-PY,es-PE,es-PR,es-DO,es-UY,es-VE,eu-ES,fil-PH,fr-CA,fr-FR,gl-ES,ka-GE,gu-IN,hr-HR,zu-ZA,is-IS,it-IT,jv-ID,kn-IN,km-KH,lo-LA,lv-LV,lt-LT,hu-HU,ml-IN,mr-IN,nl-NL,ne-NP,nb-NO,pl-PL,pt-BR,pt-PT,ro-RO,si-LK,sk-SK,sl-SI,su-ID,sw-TZ,sw-KE,fi-FI,sv-SE,ta-IN,ta-SG,ta-LK,ta-MY,te-IN,vi-VN,tr-TR,ur-PK,ur-IN,el-GR,bg-BG,ru-RU,sr-RS,uk-UA,he-IL,ar-IL,ar-JO,ar-AE,ar-BH,ar-DZ,ar-SA,ar-IQ,ar-KW,ar-MA,ar-TN,ar-OM,ar-PS,ar-QA,ar-LB,ar-EG,fa-IR,hi-IN,th-TH,ko-KR,cmn-Hant-TW,yue-Hant-HK,ja-JP,cmn-Hans-HK,cmn-Hans-CN"
        if (validLangList.split(',').indexOf(parsedMsg[1]) !== -1) {
          guildLangs.set(message.member.guild.id, parsedMsg[1])
          message.reply(` changed language to ${parsedMsg[1]}. (Use BCP-47 identifier: https://cloud.google.com/speech/docs/languages)`).catch(defaultCatcher)
        } else {
          message.reply(` invalid language. (Use BCP-47 identifier: https://cloud.google.com/speech/docs/languages)`).catch(defaultCatcher)
        }
      } else {
        const lang = getGuildLang(message.member.guild.id)
        message.reply(` current language: ${lang}. (Use BCP-47 identifier: https://cloud.google.com/speech/docs/languages)`).catch(defaultCatcher)
      }
      break
    case 'help':
      message.reply(` list of commands: ${prefix}help, ${prefix}listen, ${prefix}stop, ${prefix}lang, ${prefix}about.`).catch(defaultCatcher)
      break
    case 'about':
      message.reply(` this bot is managed by @NiciusB#8642. You can check my website at https://balbona.me/ or send me an email at nuno@balbona.me`).catch(defaultCatcher)
      break
    default:
      message.reply(` command not recognized! Type '${prefix}help' for a list of commands.`).catch(defaultCatcher)
  }
}

function commandListen(message) {
  const member = message.member
  if (!member) {
    return
  }
  if (!member.voiceChannel) {
    message.reply(" you need to be in a voice channel first.").catch(defaultCatcher)
    return
  }

  message.channel.send('Listening in to **' + member.voiceChannel.name + '**!').catch(defaultCatcher)

  destroyConnection(member.guild.id)
  member.voiceChannel.join().then((connection) => {
    voiceConnections.set(member.guild.id, connection)

    connection.playFile('./sounds/beep.mp3')
    const receiver = connection.createReceiver()

    connection.on('speaking', (memberSpeaking, isSpeaking) => {
      if (isSpeaking == true) {
        createStream(receiver, message, memberSpeaking)
      }
    })
  }).catch(defaultCatcher)
}

function createStream(receiver, message, memberSpeaking, iteration = 0) {
  if (iteration >= 3) {
    console.log("CreateStream failed too many times. Quitting.")
    return false
  }

  try {
    // let audioStream = receiver.createStream(memberSpeaking, {mode: 'pcm'})
    let audioStream = receiver.createPCMStream(memberSpeaking)
    // let audioStream = receiver.createOpusStream(memberSpeaking)
    audioStreamToText(audioStream, message, text => {
      console.log("Received Text: ", text)
      message.channel.send(`**${memberSpeaking.username}**: ${text}`).catch(defaultCatcher)
    })
  } catch (e) {
    setTimeout(() => {
      createStream(receiver, message, memberSpeaking, iteration++)
    }, 10)
  }
}

function destroyConnection(connectionID) {
  if (oldConnection = voiceConnections.get(connectionID)) {
    oldConnection.disconnect()
  }
}

function getGuildLang(guildID) {
  return guildLangs.get(guildID) || 'en-US'
}

function audioStreamToText(audioStream, message, cb) {
  console.log("Beginning audioStreamToText")
  let guildID = message.member.guild.id
  let input = new Stream.PassThrough
  let converted = new Stream.PassThrough
  // let audioFilePath = './temp/audio.pcm'
  // let fileStream = fs.createWriteStream(audioFilePath);
  // let fileStream = fs.createWriteStream(new Buffer())

  // const request = {
  //   config: {
  //     encoding: 'OGG_OPUS',
  //     sampleRateHertz: 48000,
  //     languageCode: getGuildLang(guildID),
  //   },
  //   interimResults: true, // If you want interim results, set this to true
  // };
  const request = {
    config: {
      encoding: 'LINEAR16',
      sampleRateHertz: 16000,
      // languageCode: getGuildLang(guildID),
      languageCode: 'en-US',
    },
    interimResults: false, // If you want interim results, set this to true
  };

  let recognizeStream = speechClient
    .streamingRecognize(request)
    .on('start', () => {
      console.log('Google recognizeStream start.')
    })
    .on('error', err => {
      console.log('An error occurred: ', err)
      message.channel.send(`An error occurred: ${err}`).catch(defaultCatcher)
    })
    // .on('data', data => {
    //   console.log("Speech data received.")
    //   console.log(data)
    //   if (data.error) {
    //     console.log('An error occurred: ' + data.error.message)
    //   } else {
    //     console.log("No data error. Attempting callback.")
    //     const results = data[0] ? data[0].results : false
    //     if (results && results.length) {
    //       cb(results[0].alternatives[0].transcript)
    //     } else {
    //       console.log("No text from Speech API.")
    //       console.log("Results:")
    //       console.log(data)
    //       message.channel.send(`No text from Speech API.\nResults: ${data}`).catch(defaultCatcher)
    //     }
    //   }
    // })
    .on('data', data =>
      process.stdout.write(
        data.results[0] && data.results[0].alternatives[0]
          ? `Transcription: ${data.results[0].alternatives[0].transcript}\n`
          : `\n\nReached transcription time limit, press Ctrl+C\n`
      )
    )
    .on('end', () => {
      console.log("End of recognizeStream");
      // recognizeStream.end();
    })

  // audioStream
  // .on('end', () => {
  //   console.log("listen off");
  //   // recognizeStream.end();
  // })
  // .on('error', (err) => {
  //   console.log("Error on ReadableStream: ", err);
  //   recognizeStream.end();
  // })
  // .pipe(recognizeStream)

  // audioStream
  //   .on('data', (chunk) => {
  //     console.log(`Received ${chunk.length} bytes of data.`)
  //     chunk.pipe(recognizeStream)
  //   })
  //   .on('end', () => {
  //     console.log("listen off");
  //     recognizeStream.end();
  //   })
  //   .on('error', (err) => {
  //     console.log("Error on ReadableStream: ", err);
  //     recognizeStream.end();
  //   })

  ffmpeg(audioStream)
    .inputFormat('s32le')
    .audioFrequency(16000)
    // .audioChannels(1)
    .audioCodec('pcm_s16le')
    .format('s16le')
    .on('start', () => {
      console.log('ffmpeg start')
    })
    .on('error', err => {
      console.log('An error occurred: ' + err.message)
      file.unlink()
    })
    .on('end', () => {
      console.log("ffmpeg end");
      // recognizeStream.end();
    })
    .pipe(converted)

  audioStream
  .on('end', () => {
    console.log("AudioStream end.");
    converted.pipe(recognizeStream)
    // recognizeStream.end();
  })
  .on('error', (err) => {
    console.log("Error on ReadableStream: ", err);
    recognizeStream.end();
  })
  // .pipe(recognizeStream)
}



function audioStreamToText2(audioStream, message, cb) {
  // audioStream.on('data', (chunk) => {
  //     console.log(`Received ${chunk.length} bytes of data.`);
  // });

  let guildID = message.member.guild.id
  tempfs.open({
    suffix: '.pcm'
  }, function (err, file) {
    if (err) { throw err }
    ffmpeg(audioStream)
      .inputFormat('s32le')
      .audioFrequency(48000)
      .audioChannels(1)
      .audioCodec('pcm_s16le')
      .format('s16le')
      .save(file.path)
      .on('error', function (err) {
        console.log('An error occurred: ' + err.message)
        file.unlink()
      })
      .on('end', function () {
        const audioContent = fs.readFileSync(file.path).toString('base64')
        file.unlink()
        if (!audioContent) {
          // No audio recorded
          console.log("No audio recorded")
          return false
        }
        speechClient.recognize({
          audio: {
            content: audioContent
          },
          config: {
            encoding: 'LINEAR16',
            sampleRateHertz: 16000,
            languageCode: getGuildLang(guildID),
          }
        })
          .then(data => {
            if (data.error) {
              console.log('An error occurred: ' + data.error.message)
            } else {
              const results = data[0] ? data[0].results : false
              if (results && results.length) {
                cb(results[0].alternatives[0].transcript)
              } else {
                console.log("No text from Speech API.")
                console.log("Results:")
                console.log(data)
                message.channel.send(`No text from Speech API.\nResults: ${data}`).catch(defaultCatcher)
              }
            }
          })
          .catch(err => {
            console.log('An error occurred: ', err)
            message.channel.send(`An error occurred: ${err}`).catch(defaultCatcher)
          })
      })
  })
}
