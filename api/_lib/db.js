const { MongoClient } = require("mongodb");

function getDb(name) {
  if (!process.env.MONGODB_URI) throw new Error("MONGODB_URI environment variable is not set");
  if (!global._asimaMongo) global._asimaMongo = new MongoClient(process.env.MONGODB_URI);
  const client = global._asimaMongo;
  const ready = global._asimaMongoReady || (global._asimaMongoReady = client.connect());
  return ready.then(() => client.db(name)).catch((err) => {
    global._asimaMongoReady = null;
    throw err;
  });
}

module.exports = { getDb };
