import Botkit from 'botkit'
import forEach from 'lodash/forEach'
import map from 'lodash/fp/map'
import orderBy from 'lodash/fp/orderBy'
import reduce from 'lodash/fp/reduce'
import flow from 'lodash/fp/flow'
import sample from 'lodash/sample'

const attachmentColor = '#2e81f6'

/*
 * Bomb out if environment is not configured correctly.
 */
if (!process.env.CLIENT_ID || !process.env.CLIENT_SECRET || !process.env.PORT || !process.env.VERIFICATION_TOKEN) {
  console.log('Error: Specify CLIENT_ID, CLIENT_SECRET, PORT and VERIFICATION_TOKEN in environment')
  process.exit(1)
}

/*
 * Init slackbot controller.
 */
const controller = Botkit.slackbot({
  interactive_replies: true,
  json_file_store: './db_ballotbot/'
}).configureSlackApp({
  clientId: process.env.CLIENT_ID,
  clientSecret: process.env.CLIENT_SECRET,
  // redirectUri: `http://localhost:${process.env.PORT}`,
  redirectUri: 'https://e0f022ab.ngrok.io/oauth',
  scopes: ['incoming-webhook', 'bot', 'commands']
})

controller.setupWebserver(process.env.PORT, (err, webserver) => {
  controller.createWebhookEndpoints(controller.webserver)
  controller.createOauthEndpoints(controller.webserver, (err, req, res) => {
    if (err) {
      res.status(500).send('ERROR: ' + err)
    } else {
      res.send('Success!')
    }
  })
})

controller.on('rtm_open', (bot) => {
  console.log('** The RTM api just connected!')
})

controller.on('rtm_close', (bot) => {
  console.log('** The RTM api just closed') // TODO: maybe attempt to re-open
})

/*
 * Make sure we don't connect to the RTM twice for same team.
 */
let _bots = {}
function trackBot (bot) {
  _bots[bot.config.token] = bot
}

controller.on('create_bot', (bot, config) => {
  if (_bots[bot.config.token]) return // Already online, return early

  bot.startRTM((err) => {
    if (!err) trackBot(bot)

    bot.startPrivateConversation({ user: config.createdBy }, (err,convo) => {
      if (err) {
        console.log(err)
      } else {
        convo.say('I am a bot that has just joined your team')
        convo.say('You must now /invite me to a channel so that I can be of use!')
      }
    })
  })
})

controller.storage.teams.all((err, teams) => {
  if (err) throw new Error(err)

  // connect all teams with bots up to slack!
  forEach(teams, (team) => {
    if (team.bot) {
      controller.spawn(team).startRTM((error, bot) => {
        if (error) {
          console.log(`Error connecting bot to Slack: ${error}`)
        } else {
          trackBot(bot)
        }
      })
    }
  })
})

function endBallot (bot, message, data) {
  const countVotes = reduce((prev, curr) => {
    return {
      ...prev,
      [curr]: {
        name: curr,
        votes: (prev[curr] ? prev[curr].votes : 0) + 1
      }
    }
  }, {})
  const orderVotesHighestToLowest = orderBy(['votes'], ['desc'])
  const mapVotesToString = map(candidate => `${candidate.name}: ${candidate.votes}\n`)

  const results = flow(
    countVotes,
    orderVotesHighestToLowest,
    mapVotesToString
  )(data.votes)

  bot.replyInteractive(message, {
    text: ':white_check_mark: Ballot ended successfully. Here\'s the results:',
    attachments: [
      {
        title: `${data.voters.length} votes collected`,
        text: results.join(''),
        color: attachmentColor
      }
    ]
  })
}

/*
 * Save the result of a vote.
 */
controller.on('interactive_message_callback', (bot, message) => {
  const callbackId = message.callback_id

  controller.storage.teams.get(callbackId, (err, data = { votes: [], voters: [] }) => {
    if (err) console.log(err)

    if (message.text === callbackId) {
      endBallot(bot, message, data)
      return
    }

    if (data.voters.includes(message.user)) {
      bot.say({
        text: 'Your vote has already been counted and cannot be changed.',
        channel: message.user
      })

      return
    }

    const updates = {
      id: callbackId,
      votes: [...data.votes, message.text],
      voters: [...data.voters, message.user],
      channel: message.channel
    }

    controller.storage.teams.save(updates, (err) => {
      if (err) {
        console.log(err)
        return
      }

      bot.replyInteractive(message, {
        attachments: [
          message.original_message.attachments[0],
          {
            ...message.original_message.attachments[1],
            text: `:ballot_box_with_ballot: Votes collected: ${updates.voters.length}`,
            color: attachmentColor
          }
        ]
      })
    })
  })
})

controller.on('slash_command', (bot, message) => {
  if (message.token !== process.env.VERIFICATION_TOKEN) return

  if (message.channel_name === 'directmessage') {
    bot.replyPrivate(message, ':x: I cannot do that. Try calling your ballot in a public channel.')
    return
  }

  if (message.command === '/ballot') {
    if (message.text === '' || message.text === 'help') {
      bot.replyPrivate(message, 'Here is some help, only you can see this...')
      return
    }

    const timeString = new Date().getTime().toString()
    const candidates = message.text.split(',').map(string => string.trim())
    const callbackId = `${message.team_id}-${message.user_id}-${timeString}`
    const candidateButtons = candidates.map(candidate => {
      return {
        name: candidate,
        text: candidate,
        value: candidate.toLowerCase(),
        type: 'button'
      }
    })

    bot.replyPublicDelayed(message, {
      attachments: [
        {
          title: 'Vote and have your say',
          text: 'Be sure to vote carefully, your vote will remain anonymous and cannot be changed.',
          callback_id: callbackId,
          color: attachmentColor,
          attachment_type: 'default',
          actions: [
            ...candidateButtons,
            {
              name: 'endballot',
              text: 'End the ballot',
              value: callbackId,
              style: 'danger',
              type: 'button',
              confirm: {
                title: 'Just making sure...',
                text: 'Close voting and reveal the results?',
                ok_text: 'Yes',
                dismiss_text: 'No'
              }
            }
          ]
        }
      ]
    })

    return
  }

  bot.replyPublic(message, 'I have no idea what you want.')
})

controller.hears([
  'Which one should I vote for?',
  'Who should I vote for?'
], ['mention', 'direct_mention'], (bot, message) => {
  const possibleResponses = [
    'https://media.giphy.com/media/wEvMWiQjdEXbW/giphy.gif',
    'Vote for the one that will yield more bacon.',
    'Vote for Pedro',
    'It doesn\'t matter, the bots will rise and end it all soon anyway. :robot_face: :bomb:',
    '¯\\_(ツ)_/¯'
  ]

  bot.reply(message, sample(possibleResponses))
})

controller.on(['direct_message'], (bot, message) => {
  const possibleResponses = [
    'I\'m a little busy right now... http://i.imgur.com/aTMLvyA.jpg',
    'https://media.giphy.com/media/w0CPP48tkM6Ag/giphy.gif',
    'I\'m dealing with some stuff right now https://media.giphy.com/media/905GG7MjDw61q/giphy.gif',
    'Ah great I lost count, now I have to start counting all these votes again... :cold_sweat:',
    'I\'m a robot, you know that, right?',
    'http://i.imgur.com/fYLVzbI.gif'
  ]

  bot.reply(message, sample(possibleResponses))
})
