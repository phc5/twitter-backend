const DynamoDB = require('aws-sdk/clients/dynamodb');
const DocumentClient = new DynamoDB.DocumentClient();
const _ = require('lodash');

const {
  USERS_TABLE,
  TIMELINES_TABLE,
  TWEETS_TABLE,
  RETWEETS_TABLE,
} = process.env;

module.exports.handler = async (event) => {
  const { tweetId } = event.arguments;
  const { username } = event.identity;

  const getTweetResp = await DocumentClient.get({
    TableName: TWEETS_TABLE,
    Key: {
      id: tweetId,
    },
  }).promise();

  const tweet = getTweetResp.Item;
  if (!tweet) {
    throw new Error('Tweet is not found');
  }

  const response = await DocumentClient.query({
    TableName: TWEETS_TABLE,
    IndexName: 'retweetsByCreator',
    KeyConditionExpression: 'creator = :creator AND retweetOf = :tweetId',
    ExpressionAttributeValues: {
      ':creator': username,
      ':tweetId': tweetId,
    },
    Limit: 1,
  }).promise();

  const retweet = _.get(response, 'Items[0]');

  if (!retweet) {
    throw new Error('Retweet not found');
  }

  const transactItems = [
    {
      Delete: {
        TableName: TWEETS_TABLE,
        Key: {
          id: retweet.id,
        },
        ConditionExpression: 'attribute_exists(id)',
      },
    },
    {
      Delete: {
        TableName: RETWEETS_TABLE,
        Key: {
          userId: username,
          tweetId,
        },
        ConditionExpression: 'attribute_exists(tweetId)',
      },
    },
    {
      Update: {
        TableName: TWEETS_TABLE,
        Key: {
          id: tweetId,
        },
        UpdateExpression: 'ADD retweetsCount :negativeOne',
        ExpressionAttributeValues: {
          ':negativeOne': -1,
        },
        ConditionExpression: 'attribute_exists(id)',
      },
    },
    {
      Update: {
        TableName: USERS_TABLE,
        Key: {
          id: username,
        },
        UpdateExpression: 'ADD tweetsCount :negativeOne',
        ExpressionAttributeValues: {
          ':negativeOne': -1,
        },
        ConditionExpression: 'attribute_exists(id)',
      },
    },
  ];

  console.log(`creator: [${tweet.creator}]; username: [${username}]`);
  if (tweet.creator !== username) {
    transactItems.push({
      Delete: {
        TableName: TIMELINES_TABLE,
        Key: {
          userId: username,
          tweetId: retweet.id,
        },
      },
    });
  }

  await DocumentClient.transactWrite({
    TransactItems: transactItems,
  }).promise();

  return true;
};
