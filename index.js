const express = require('express');
const fetch = require('node-fetch'); // Library for making HTTP requests
const multer  = require('multer'); // Middleware for handling multipart/form-data (file uploads)
const cors = require('cors'); // CORS middleware
const PDFParser = require('pdf-parse'); // Import pdf-parse
const OpenAI = require("openai");
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '.env') });
const bodyParser = require('body-parser'); // Middleware for parsing JSON request body
const { promisify } = require('util');
const { TextDecoder } = require('util');


// import classes
// const { ApiInterface } = require("./apiInterface");
// const { Chatbot } = require("./chatbot.js");

const app = express();
const upload = multer(); // Don't specify a destination directory

// Parse JSON request bodies
app.use(express.json());

app.use(cors({origin:true,credentials: true}));

// In-memory storage for file data
let file = {};

// Define a route to handle file uploads
app.post('/upload-link', async (req, res) => {
	console.log(req.body)
  const { link } = req.body;

  if (!link) {
    return res.status(400).send('Invalid request. "link" field is required in the JSON object.');
  }

  try {
    // Fetch the text content from the provided link
    const response = await fetch(link);
    const fileContent = await response.text();

    // Parse the text content if it's a PDF file
    let parsedContent = fileContent;
    if (link.endsWith('.pdf')) {
      const pdfData = await PDFParser(fileContent);
      parsedContent = pdfData.text;
    }

    // Store the file data in memory
    file = {
      link,
      content: parsedContent
    };

    // Send response
    res.send('File read successfully and stored in memory.');
		console.log(file.content)
  } catch (error) {
    console.error('Error:', error);
    res.status(500).send('An error occurred while processing the file.');
  }
});

// Define a route to handle sending messages
app.post('/send-message', async (req, res) => {
  try {
    // Extract previousHistory and newMessage from the request body
    const { previousHistory, newMessage } = req.body;

    // Check if previousHistory and newMessage are provided
    if (!Array.isArray(previousHistory) || typeof newMessage !== 'string') {
      return res.status(400).send('Invalid request body. "previousHistory" should be an array of objects and "newMessage" should be a string.');
    }

		const chatbot = new Chatbot();

		let response = null;

		if (file) {
			// Send message using the Chatbot class
			response = await chatbot.sendMessage(previousHistory, file.content, newMessage);
		} else {
			return res.status(500).send('Error occurred, please upload link to file for context');
		}

		console.log(response)

    // Send the response back to the client
    res.json({ response });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).send('An error occurred while sending the message.');
  }
});

// Route to handle reordering tasks
app.post('/reorder-tasks', async (req, res) => {
  try {
    // Extract tasksArray from the request body
    const { tasksArray } = req.body;

		const apiInterface = new ApiInterface();

    // Check if tasksArray is provided and is an array
    if (!Array.isArray(tasksArray)) {
      return res.status(400).json({ error: 'Invalid request body. "tasksArray" should be an array.' });
    }

    // Call reorderTasks function from ApiInterface
    const reorderedTasks = await apiInterface.reorderTasks(tasksArray);

		console.log(reorderedTasks);

    // Send the reordered tasks as the response
    res.json(reorderedTasks);
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: 'An error occurred while reordering tasks.' });
  }
});

// Define a route to handle file uploads
app.post('/upload-file', upload.single('file'), async (req, res) => {
  // Access the uploaded file via req.file
  if (!req.file) {
    return res.status(400).send('No files were uploaded.');
  }
  
  // Parse the PDF content
  const fileBuffer = req.file.buffer; // Get the file buffer

	const pdfData = await PDFParser(fileBuffer); // Parse PDF content

  // Access parsed PDF content
  console.log(pdfData.text); // Log the text content of the PDF

  res.send('File uploaded successfully!');
});

// Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});

class Chatbot {
	constructor() {
			this.openai = new OpenAI({
					apiKey: process.env.OPENAI_AUTH,
			});
	}

	setupModelDetails(instructions, prompt) {
		const modelDetails = {
			model: 'gpt-3.5-turbo-0125',
			messages: [{"role": "user", "content": `INSTRUCTIONS TO BE FOLLOWED: ${instructions} PROMPT: ${prompt}`}],
			temperature: 0.5,
			max_tokens: 1024
		};

		return modelDetails;
	}

	async sendMessage(previousHistory, pdfContent, newMessage) {
		const instructions = `
		INSTRUCTIONS: 
		This is a chatbot implementation providing data being talked about and previous chat messages as context.

		DATA being asked about:
		${pdfContent}

		Following is the previous chat history arranged in order, use this as context

		${JSON.stringify(previousHistory)}
		
		IMPORTANT: Utilize the chat history as context and answer prompt question regarding DATA,
		and reply as if you are the chatbot in the conversation array continuing the conversation by replying to the new prompt`

		const prompt = newMessage;

		const modelObj = this.setupModelDetails(instructions, prompt)

		try {
			const response = await this.openai.chat.completions.create(modelObj);
			return response.choices[0].message.content;
		} catch(error) {
			console.error("Error:", error);
		}
	}
}

class ApiInterface { 
	constructor() {
			this.openai = new OpenAI({
					apiKey: process.env.OPENAI_AUTH,
			});
	}

	setupModelDetails(instructions, prompt) {
		const modelDetails = {
			model: 'gpt-3.5-turbo-0125',
			messages: [{"role": "user", "content": `INSTRUCTIONS TO BE FOLLOWED: ${instructions} PROMPT: ${prompt}`}],
			temperature: 0,
			max_tokens: 1024
		};

		return modelDetails;
	}

	async reorderTasks(tasksArray) {
		const instructions = `
		Based on all the information provided for all the tasks,
		weigh each option against each other for all tasks
		pecentageWorth of each task
		dueDate of each task
		
		to determine which task the user should work on next
		
		IMPORTANT: Give back JUST an array of these objects reordered with the tasks reordered, and the tasks order in descending order of importance, 
		the most important task is the very first in the list and 
		the least important is at the very bottom of the array`

		const prompt = JSON.stringify(tasksArray);

		const modelObj = this.setupModelDetails(instructions, prompt)

		try {
			const response = await this.openai.chat.completions.create(modelObj);

			return JSON.parse(response.choices[0].message.content);
		} catch(error) {
			console.error("Error:", error);
		}
	}

	// async generatePromptResponse(instructions, messages) {
	//     try {
	//         const response = await this.openai.chat.completions.create({
	//             model: 'gpt-3.5-turbo-0125',
	//             messages: [{"role": "user", "content": `${instructions} PROMPT: ${messages}`}],
	// 						temperature: 0,
	// 						max_tokens: 10
	//         });
	
	//         return response.choices[0].message.content;
	//     } catch (error) {
	//         console.error("Error:", error);
	//         return null; // or throw error
	//     }
	// }
}

