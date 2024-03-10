const express = require('express');
const fetch = require('node-fetch'); // Library for making HTTP requests
const multer  = require('multer'); // Middleware for handling multipart/form-data (file uploads)
const cors = require('cors'); // CORS middleware
const PDFParser = require('pdf-parse'); // Import pdf-parse
const OpenAI = require("openai");
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '.env') });

const app = express();
const upload = multer(); // Don't specify a destination directory

// Parse JSON request bodies
app.use(express.json());

// Define custom CORS options to allow preflight requests
const corsOptions = {
  origin: '*', // Allow requests from any origin
  methods: ['GET', 'POST'], // Allow only GET and POST requests
  allowedHeaders: ['Content-Type'], // Allow only the Content-Type header
};

// Use the cors middleware with custom options
app.use(cors(corsOptions));

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
   // Parse the request body if it's not already parsed
	 const { messages, userMessage } = req.body;

	 // Check if messages and userMessage are provided
	 if (!messages || !Array.isArray(messages) || typeof userMessage !== 'string') {
		 return res.status(400).send('Invalid request body');
	 }

	 console.log("Messages:", messages);
	 console.log("User Message:", userMessage);

    // // Check if previousHistory and newMessage are provided
    // if (!Array.isArray(messages)) {
    //   return res.status(400).send('Invalid request body. "previousHistory" should be an array of objects');
    // }

		// if (newMessage !== String) {
		// 	return res.status(400).send('and "newMessage" should be a string.');
		// }

		const chatbot = new Chatbot();

		let response = await chatbot.sendMessage(messages, "", userMessage);

		// if (file) {
		// 	// Send message using the Chatbot class
		// 	response = await chatbot.sendMessage(previousHistory, file.content, newMessage);
		// } else {
		// 	return res.status(500).send('Error occurred, please upload link to file for context');
		// }

		console.log(response)

    // Send the response back to the client
    res.json({ response });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).send('An error occurred while sending the message.');
  }
});

let processing_reorder = false; // State variable to track processing status

// Route to handle reordering tasks
app.post('/reorder-tasks', async (req, res) => {
  try {

		if(processing_reorder) {
			return res.status(200).json({message: 'Please wait'});
		}

		processing_reorder = true;
    // Extract tasksArray from the request body
    const tasksArray = req.body;
		console.log(req)

		const apiInterface = new ApiInterface();

    // Call reorderTasks function from ApiInterface
    const reorderedTasks = await apiInterface.reorderTasks(tasksArray);

		console.log(reorderedTasks);

    // Send the reordered tasks as the response
    res.json(reorderedTasks);
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: 'An error occurred while reordering tasks.' });
  } finally {
		processing_reorder = false;
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
			model: 'gpt-3.5-turbo',
			messages: [{"role": "user", "content": `INSTRUCTIONS TO BE FOLLOWED: ${instructions} PROMPT: ${prompt}`}],
			temperature: 0,
			max_tokens: 1024
		};

		return modelDetails;
	}

	async sendMessage(previousHistory, pdfContent, newMessage) {
		const instructions = `
		INSTRUCTIONS: 
		This is a chatbot implementation providing data being talked about and previous chat messages as context.

		DATA being asked about [if no data is provided, ignore data and continue chatting with context]:
		${pdfContent}

		Following is the previous chat history arranged in order, use this as context

		${JSON.stringify(previousHistory)}
		
		IMPORTANT: Utilize the chat history as context and answer prompt question regarding DATA [if provided],
		and reply as if you are the chatbot in the conversation continuing the conversation by replying to the new prompt`

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
		console.log(prompt);
		const modelDetails = {
			model: 'gpt-3.5-turbo',
			messages: [{"role": "user", "content": `INSTRUCTIONS TO BE FOLLOWED: ${instructions} PROMPT: ${prompt}`}],
			temperature: 0,
			max_tokens: 4096
		};

		return modelDetails;
	}

	async reorderTasks(tasksArray) {

		const currentDate = new Date();

		// Format the date string in ISO format (e.g., "2024-03-10T12:30:45.678Z")
		const currentDateTimeString = currentDate.toISOString();

		const instructions = `
		Based on all the information provided for all the tasks,
		weigh each option against each other
		the factors to consider are dueDate and percentWorth, 
		if the dueDate is closer to the current date, it should be placed higher in priority
		also if an assignment is worth a more percent-wise it should be higher in priority as well
		Compare these two factors for each task in the array (each object is one task) to determine the order.
		REMEMBER tasks with more priority are put first in the array and then in descending order of priority.

		CurrentDate: ${currentDateTimeString}.
		
		IMPORTANT: Give back JUST an ARRAY with the tasks reordered and don't change the data.
		The most important task is the very first in the list and 
		The least important is at the very bottom of the array`

// 		const instructions = `
// 		This prompt is designed to reorder a list of tasks based on their priority. Each task is represented as an object within an array, with the following properties:

// 			- _id: Unique identifier for the task.
// 			- creator: Information about the creator of the task.
// 			- course: ID of the course related to the task.
// 			- name: Name or title of the task.
// 			- type: Type of the task.
// 			- status: Status of the task (e.g., in_progress, completed).
// 			- dueDate: Due date of the task.
// 			- file: Link to any associated file for the task.
// 			- description: Description or details of the task.
// 			- percentageWorth: Percentage worth of the task.

// 			The task array has been randomly ordered, and your goal is to reorder it based on the priority of tasks. The priority is determined by two factors: due date and percentage worth. Tasks with earlier due dates and higher percentage worth should be placed higher in the list.

// 			Your task is to rearrange the tasks array such that tasks are ordered in descending order of priority, with the most important task appearing first in the list.

// 			Please reorder the tasks array accordingly and return the modified array (with the original data) as the output
			
// 			RETURN THE REORDERED ARRAY ACCORDING TO PRIORITY.
// `

		const prompt = JSON.stringify(tasksArray);

		console.log(prompt);

		const modelObj = this.setupModelDetails(instructions, prompt)

		try {
			const response = await this.openai.chat.completions.create(modelObj);
			console.log(response.choices[0].message.content)
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

//  const tasksArray = [
  //   {
  //     title: "Lab 3: SQL Queries",
  //     dueDate: "2023-03-16",
  //     type: "assignment",
  //     status: "in-progress",
  //     course: "COMP 4537",
  //     percentageWorth: 10
  //   },
  //   {
  //     title: "Assignment 2: Data Structures",
  //     dueDate: "2023-03-13",
  //     type: "assignment",
  //     status: "completed",
  //     course: "COMP 3760",
  //     percentageWorth: 15,
  //   },
  //   {
  //     title: "Assignment 4: Ethics Report",
  //     dueDate: "2023-04-01",
  //     type: "assignment",
  //     status: "in-progress",
  //     course: "LIBS 7102",
  //     percentageWorth: 10
  //   },
  //   {
  //     title: "Midterm Exam: Object-Oriented Programming",
  //     dueDate: "2023-04-06",
  //     type: "exam",
  //     status: "in-progress",
  //     course: "COMP 3522",
  //     percentageWorth: 10
  //   },
  //   {
  //     title: "Quiz 2: Operating Systems",
  //     dueDate: "2023-03-08",
  //     type: "quiz",
  //     status: "in-progress",
  //     course: "COMP 4736",
  //     percentageWorth: 2,
  //   }
  //   ]

  

  // useEffect(() => {
  //   const postData = async () => {
  //     setLoading(true);
  //     try {
  //       // Make a POST request to the server with the tasks JSON array
  //       const response = await axios.post('https://qds2024-ai-api.vercel.app/reorder-tasks', tasksArray);
  
  //       // Log the response from the server
  //       console.log('Response:', response.data);
  //       alert('Tasks sent successfully!');
  //     } catch (error) {
  //       console.error('Error:', error);
  //       alert('Error sending tasks');
  //     } finally {
  //       setLoading(false);
  //     }
  //   };

  //   postData();
  // }, []); // Empty dependency array ensures the effect runs only once after initial render

