import { GoogleGenerativeAI } from "@google/generative-ai";
import axios from "axios";

export const callLLMApi = async (model, apiKey, prompt, history = []) => {
  try {
    switch (model) {
      case "gemini-2.0-flash":
        return await callGeminiAPI(apiKey, prompt, history);
      
      case "gpt-4o":
        return await callOpenAIAPI(apiKey, prompt, history);
      
      case "mistral-large-latest":
        return await callMistralAPI(apiKey, prompt, history);
      
      case "deepseek-chat":
        return await callDeepSeekAPI(apiKey, prompt, history);
      
      default:
        throw new Error(`Unsupported model: ${model}`);
    }
  } catch (error) {
    console.error(`LLM API call failed for model ${model}:`, error.message);
    throw new Error(`Failed to get response from ${model}: ${error.message}`);
  }
};

const callGeminiAPI = async (apiKey, prompt, history) => {
  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash-exp" });

  // Convert history to Gemini format
  const chatHistory = history.map(msg => ({
    role: msg.senderId ? "user" : "model",
    parts: [{ text: msg.text }]
  }));

  const chat = model.startChat({
    history: chatHistory,
  });

  const result = await chat.sendMessage(prompt);
  const response = await result.response;
  return response.text();
};

const callOpenAIAPI = async (apiKey, prompt, history) => {
  const messages = [
    { role: "system", content: "You are a helpful assistant." },
    ...history.map(msg => ({
      role: msg.senderId ? "user" : "assistant",
      content: msg.text
    })),
    { role: "user", content: prompt }
  ];

  const response = await axios.post(
    "https://api.openai.com/v1/chat/completions",
    {
      model: "gpt-4o",
      messages: messages,
      max_tokens: 1500,
      temperature: 0.7,
    },
    {
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
    }
  );

  return response.data.choices[0].message.content;
};

const callMistralAPI = async (apiKey, prompt, history) => {
  const messages = [
    { role: "system", content: "You are a helpful assistant." },
    ...history.map(msg => ({
      role: msg.senderId ? "user" : "assistant",
      content: msg.text
    })),
    { role: "user", content: prompt }
  ];

  const response = await axios.post(
    "https://api.mistral.ai/v1/chat/completions",
    {
      model: "mistral-large-latest",
      messages: messages,
      max_tokens: 1500,
      temperature: 0.7,
    },
    {
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
    }
  );

  return response.data.choices[0].message.content;
};

const callDeepSeekAPI = async (apiKey, prompt, history) => {
  const messages = [
    { role: "system", content: "You are a helpful assistant." },
    ...history.map(msg => ({
      role: msg.senderId ? "user" : "assistant",
      content: msg.text
    })),
    { role: "user", content: prompt }
  ];

  const response = await axios.post(
    "https://api.deepseek.com/chat/completions",
    {
      model: "deepseek-chat",
      messages: messages,
      max_tokens: 1500,
      temperature: 0.7,
    },
    {
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
    }
  );

  return response.data.choices[0].message.content;
};