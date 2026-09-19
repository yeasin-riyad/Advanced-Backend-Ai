import express from "express";
import dotenv from "dotenv";
import { GoogleGenAI } from "@google/genai";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import { ChatGroq } from "@langchain/groq";
import { TavilySearch } from "@langchain/tavily";
import {
  Annotation,
  MemorySaver,
  MessagesAnnotation,
  StateGraph,
} from "@langchain/langgraph";

dotenv.config();
const app = express();
const port = 5000;
app.use(express.json());

//without Langchain
// const ai = new GoogleGenAI({
//     apiKey: process.env.GEMINI_API_KEY
// })

// app.post("/ai", async (req, res) => {
//     const { input } = req.body
//     const response = await ai.models.generateContent({
//         model: "gemini-3.5-flash",
//         contents: [
//             {
//                 role: "system",
//                 parts: [{ text: "you are a assistant and your name is jarvis.if you don't know the answer then don't give incorrect answer" }]
//             },
//             {
//                 role: "user",
//                 parts: [{ text: input }]
//             }
//         ]
//     })

//     return res.status(200).json({ "ai:": response.text })
// })

//With Langchin
// const llm = new ChatGoogleGenerativeAI({
//     model: "gemini-3.5-flash", // মডেলের নাম নির্ধারণ করা হয়েছে
//     temperature: 0,            // তাপমাত্রা ০ করার অর্থ হলো মডেলটি সবচেয়ে নির্ভুল এবং একই ধরণের উত্তর দেবে (কোনো সৃজনশীলতা থাকবে না)
//     maxOutputTokens: 100,      // মডেলটি সর্বোচ্চ ১০০টি টোকেন (শব্দ বা শব্দের অংশ) সম্বলিত উত্তর তৈরি করতে পারবে
//     maxRetries: 2,             // কোনো কারণে রিকোয়েস্ট ব্যর্থ হলে এটি সর্বোচ্চ ২ বার পুনরায় চেষ্টা (retry) করবে
// })

// app.post("/ai", async (req, res) => {
//     const { input } = req.body
//     const response= await llm.invoke(input);
//     return res.status(200).json({ "ai:": response.content })
// })

const tool = new TavilySearch({
  maxResults: 5,
  topic: "general",
  // includeAnswer: false,
  // includeRawContent: false,
  // includeImages: false,
  // includeImageDescriptions: false,
  // searchDepth: "basic",
  // timeRange: "day",
  // includeDomains: [],
  // excludeDomains: [],
})
const tools = [tool]
const toolNode = new ToolNode(tools);

const checkPointer = new MemorySaver();

//LangGraph কনফিগারেশন এবং গ্রাফ তৈরি
const llm = new ChatGroq({
  model: "openai/gpt-oss-120b", // Groq-এর মাধ্যমে ব্যবহার করা নির্দিষ্ট এআই মডেলের নাম
  temperature: 0.7,             // ক্রিয়েটিভিটি লেভেল (০.৭ মানে উত্তর কিছুটা বৈচিত্র্যময় ও প্রাকৃতিক হবে)
  maxRetries: 2,                // রিকোয়েস্ট ফেইল করলে সর্বোচ্চ ২ বার পুনরায় চেষ্টা করবে
}).bindTools(tools);



//Annotation.Root ব্যবহার করে আপনি গ্রাফের জন্য একটি সেন্ট্রাল ডেটাবেজ বা 
// মেমোরির স্ট্রাকচার তৈরি করেন
// const State = Annotation.Root({
//   prompt: Annotation,           // ব্যবহারকারীর পাঠানো ইনপুট বা প্রশ্ন রাখার জায়গা
//   aiMsg: Annotation,            // এআই যে উত্তরটি তৈরি করবে তা রাখার জায়গা
// });




// মূল ফাংশন (Node) যা এলএলএম (LLM) কল করে উত্তর নিয়ে আসবে
const callLLM = async (state) => {
    console.log("state:", state)

    const response = await llm.invoke([
        {
            role: "system",
            content: `You are Jarvis AI assistant

Use conversation memory first.

Only use tools when the answer requires
external real-time information like:
weather, news, web search, stock prices etc.

Do NOT call tools for simple conversation,
memory-based questions, greetings,
or personal context.
CRITICAL FORMATTING RULE: 
Always provide your final response in plain paragraph text. 
Do NOT use markdown tables, bullet points, numbered lists, or structural headers. 
Keep the flow natural and conversational within standard paragraphs.`
        },
        ...state.messages
    ])

    return { messages: [response] }
}


const shouldContinue = async (state) => {
    const lastMessage = state.messages[state.messages.length - 1]
    if (lastMessage.tool_calls.length > 0) {
        return "tools"
    } else {
        return "__end__"
    }
}

// কাজের প্রবাহ বা গ্রাফের রুট ম্যাপ তৈরি করা
const graph = new StateGraph(MessagesAnnotation)
    .addNode("agent", callLLM)       // 'agent' নামে একটি নোড তৈরি করে সেখানে callLLM ফাংশন যুক্ত করা হলো
    .addNode("tools",toolNode)
    .addEdge("__start__", "agent")   // গ্রাফের কাজ শুরু হলেই সরাসরি 'agent' নোডে চলে যাবে
    .addEdge("tools", "agent")
    .addConditionalEdges("agent", shouldContinue)
    .compile({ checkpointer: checkPointer })              // পুরো গ্রাফটিকে রান করার জন্য রেডি বা কম্পাইল করা হলো

// এক্সপ্রেস জেএস (Express.js) এর পোস্ট রাউট বা এপিআই এন্ডপয়েন্ট
app.post("/ai", async (req, res) => {
    const { input } = req.body; // ব্যবহারকারীর পাঠানো প্রশ্নটি বডি থেকে নেওয়া হচ্ছে
    
    // গ্রাফটি চালু করা হচ্ছে এবং ইনপুট হিসেবে 'prompt'-এ ব্যবহারকারীর প্রশ্নটি দেওয়া হচ্ছে
    // const response = await graph.invoke({ prompt: input });
        const response = await graph.invoke({
            messages:[
                {
                    role:"user",
                    content:input
                }
            ]
        },
    
         { configurable: { thread_id: "user123" } }
    );

    console.log(response); // গ্রাফের ফাইনাল স্টেট বা আউটপুট কনসোলে প্রিন্ট করা
    
    // সফলভাবে উত্তরটি ফ্রন্টএন্ড বা ক্লায়েন্টের কাছে পাঠানো হচ্ছে
    //  return res.status(200).json({ "ai:": response.messages }) 
         return res.status(200).json({ "ai:": response.messages[response.messages.length-1].content}) 

})


// const graph = new StateGraph(MessagesAnnotation)
//     .addNode("agent", callLLM)
//     .addNode("tools", toolNode)
//     .addEdge("__start__", "agent")
//     .addEdge("tools", "agent")
//     .addConditionalEdges("agent", shouldContinue)
//     .compile({ checkpointer: checkPointer })

app.get("/", (req, res) => {
  return res.json({ message: "hello from level4" });
});

app.listen(port, () => {
  console.log("server started");
});
