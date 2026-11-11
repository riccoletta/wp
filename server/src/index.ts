import { createApp } from './app.js'
import { initDb } from './db.js'

await initDb()
const port = Number(process.env.PORT || 3000)
createApp().listen(port, () => console.log(`API in ascolto su http://localhost:${port}`))
