import express from "express"
import dotenv from "dotenv"

dotenv.config()
const app = express()
const port = 5000
app.use(express.json())


app.get("/", (req, res) => {
    return res.json({ message: "hello from level4" })
})


app.listen(port, () => {
    console.log("server started from level 4 phase 2")
})