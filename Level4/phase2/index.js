import express from "express";
import dotenv from "dotenv";
import { ChatGroq } from "@langchain/groq";
import fs from "fs";
import { PDFParse } from "pdf-parse";
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import { GoogleGenerativeAIEmbeddings } from "@langchain/google-genai";
import { TaskType } from "@google/generative-ai";
import { QdrantVectorStore } from "@langchain/qdrant";
import { HumanMessage, SystemMessage } from "@langchain/core/messages"

dotenv.config();
const app = express();
const port = 6000;
app.use(express.json());

const llm = new ChatGroq({
  model: "openai/gpt-oss-120b",
  temperature: 0.7,
  maxTokens: 100,
  maxRetries: 2,
});

const embeddings = new GoogleGenerativeAIEmbeddings({
  model: "gemini-embedding-001", // 768 dimensions
  taskType: TaskType.RETRIEVAL_DOCUMENT,
  title: "Document title",
});

const vectorStore = await QdrantVectorStore.fromExistingCollection(embeddings, {
  url: process.env.QDRANT_URL,
  collectionName: "grocery-store",
});

const upload = async () => {
  const pdfPath = "./knowledge.pdf"; // যে পিডিএফ ফাইলটি পড়তে হবে তার পাথ বা লোকেশন নির্ধারণ করা হলো
  const buffer = fs.readFileSync(pdfPath); // ফাইলটি থেকে সমস্ত র-ডেটা (Raw Data) মেমোরিতে রিড করা হলো
  const pdfResult = new PDFParse({ data: buffer }); // পিডিএফ পার্সার দিয়ে র-ডেটা প্রসেস করার জন্য অবজেক্ট তৈরি করা হলো
  const result = await pdfResult.getText(); // পিডিএফ-এর ভেতরের সব টেক্সট বা লেখা এক্সট্রাক্ট করা হলো
  const text = result.text; // এক্সট্রাক্ট করা মূল টেক্সটটুকু একটি ভ্যারিয়েবলে রাখা হলো

  // বিশাল টেক্সটকে ছোট ছোট অর্থপূর্ণ টুকরো বা চাঙ্কে (Chunk) ভাগ করার জন্য স্প্লিটার কনফিগার করা হচ্ছে
  const spilitter = new RecursiveCharacterTextSplitter({
    chunkSize: 1000, // প্রতিটি টুকরো বা চাঙ্কের সর্বোচ্চ সাইজ হবে ১০০০ ক্যারেক্টার
    chunkOverlap: 200, // কনটেক্সট ঠিক রাখতে আগের চাঙ্কের শেষ ২০০ ক্যারেক্টার পরের চাঙ্কের শুরুতে রিপিট হবে
  });

  // উপরের নিয়ম অনুযায়ী মূল টেক্সট ফাইলটিকে টুকরো করে ল্যাংচেইন ডকুমেন্ট অবজেক্টের একটি অ্যারে তৈরি করা হচ্ছে
  const docs = await spilitter.createDocuments([text]);

  await vectorStore.addDocuments(docs); // তৈরি হওয়া ডকুমেন্টগুলো ভেক্টর ডাটাবেজে সেভ করার লাইন (আপাতত কমেন্ট করা)
};

app.post("/ai", async (req, res) => {
  // await upload();
  const { input } = req.body;
  const docs = await vectorStore.similaritySearch(input, 5);
  const context = docs.map((d) => d.pageContent).join("/n");
  const response = await llm.invoke([
    new SystemMessage(`You are a RAG AI assistant.

STRICT RULES:
- Answer ONLY from context
- Do not use outside knowledge
- If answer not found say:
  "I don't know from uploaded PDF."

Context:
${context}`),
    new HumanMessage(input),
  ]);

  console.log(response);

  return res.status(200).json({ ai: response.content });
});
app.get("/", (req, res) => {
  return res.json({ message: "hello from level4" });
});

app.listen(port, () => {
  console.log("server started from level 4 phase 2");
});
