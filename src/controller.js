import Botkit from 'botkit'
import redisStorage from 'botkit-storage-redis'

if (!process.env.REDIS_URL) {
  console.log('Connecting to default redis url: redis://127.0.0.1:6379')
}

const redis = redisStorage({
  url: process.env.REDIS_URL || 'redis://127.0.0.1:6379'
})

const controller = Botkit.slackbot({
  storage: redis,
  interactive_replies: true,
  debug: false
}).configureSlackApp({
  clientId: process.env.CLIENT_ID,
  clientSecret: process.env.CLIENT_SECRET,
  redirectUri: 'https://slack-ballotbot.herokuapp.com',
  scopes: ['incoming-webhook', 'bot', 'commands']
})

export default controller
