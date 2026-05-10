const { AzureChatOpenAI, AzureOpenAIEmbeddings } = require("@langchain/openai");

const chatModel = new AzureChatOpenAI({
  azureOpenAIApiKey: process.env.AZURE_CHAT_KEY,
  azureOpenAIApiInstanceName: process.env.AZURE_CHAT_INSTANCE,
  azureOpenAIApiEndpoint: `https://${process.env.AZURE_CHAT_INSTANCE}.cognitiveservices.azure.com/`,
  azureOpenAIApiDeploymentName: process.env.AZURE_CHAT_DEPLOYMENT,
  azureOpenAIApiVersion: process.env.AZURE_CHAT_VERSION,
});

const embeddings = new AzureOpenAIEmbeddings({
  azureOpenAIApiKey: process.env.AZURE_EMBEDDING_KEY,
  azureOpenAIApiInstanceName: process.env.AZURE_EMBEDDING_INSTANCE,
  azureOpenAIApiEndpoint: `https://${process.env.AZURE_EMBEDDING_INSTANCE}.cognitiveservices.azure.com/`,
  azureOpenAIApiEmbeddingsDeploymentName: process.env.AZURE_EMBEDDING_DEPLOYMENT,
  azureOpenAIApiVersion: process.env.AZURE_EMBEDDING_VERSION,
});

module.exports = {
  chatModel,
  embeddings,
};
