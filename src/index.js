import controller from './controller'
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

controller.setupWebserver(process.env.PORT || 5000, (err, webserver) => {
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
        convo.say('Hi, I\'m ballotbot!')
        convo.say('/invite me to a channel if you want to ask for help. Otherwise, check out this link to learn more about me: https://github.com/slwen/ballotbot')
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

function endBallot (bot, message, votes, voters) {
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
  )(votes)

  bot.replyInteractive(message, {
    text: ':white_check_mark: Ballot ended successfully. Here\'s the results:',
    attachments: [
      {
        title: `${voters.length} votes collected`,
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
  bot.replyAcknowledge()
  const callbackId = message.callback_id

  controller.storage.teams.get(callbackId, (err, data) => {
    if (err) console.log(err)

    const votes = data ? data.votes : []
    const voters = data ? data.voters : []

    if (message.text === callbackId) {
      endBallot(bot, message, votes, voters)
      return
    }

    if (voters.includes(message.user)) {
      bot.say({
        text: 'Your vote has already been counted and cannot be changed.',
        channel: message.user
      })

      return
    }

    const updates = {
      id: callbackId,
      votes: [...votes, message.text],
      voters: [...voters, message.user],
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
  bot.replyAcknowledge()

  if (message.token !== process.env.VERIFICATION_TOKEN) return

  if (message.channel_name === 'directmessage') {
    bot.replyPrivate(message, ':x: I cannot do that. Try calling your ballot in a public channel.')
    return
  }

  if (message.command === '/ballot') {
    if (message.text === '' || message.text === 'help') {
      bot.replyPrivate(message, "Add a comma separated list of ballot candidates and I will take care of the rest.\nFor example: `/ballot Ruby, Python, Node.js, PHP`")
      return
    }

    const timeString = new Date().getTime().toString()
    const callbackId = `${message.team_id}-${message.user_id}-${timeString}`
    const candidates = message.text.split(',').map(string => string.trim()).filter(string => !!string)

    if (!candidates.length) {
      bot.replyPrivate(message, "Looks like you didn't provide any candidates... :confused: \nTry separating each candidate with a comma, for example: `/ballot Coke, Pepsi, Dr. Pepper`")
      return
    }

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
                text: 'End the ballot and reveal the results?',
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

controller.hears('help', ['mention', 'direct_mention'], (bot, message) => {
  bot.reply(message, {
    mrkdwn: true,
    text: 'Start by typing /ballot, then add a comma separated list of ballot candidates. I will take care of the rest. For example:\n `/ballot Pizza, Burgers, Chicken, Salad`'
  })
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
