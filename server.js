const express = require("express");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = 3000;

const filePath = path.join(__dirname, "jobs.json");

app.use(express.json());
app.use(express.static("public"));

app.get("/jobs", (req, res) => {
    const data = JSON.parse(fs.readFileSync(filePath));
    res.json(data);
});

app.post("/updateStatus", (req, res) => {
    const { site, jobId, status } = req.body;

    const data = JSON.parse(fs.readFileSync(filePath));

    const job = data[site].jobs.find(j => j.id === jobId);

    if (job) {
        job.status = status;
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
        res.json({ success: true });
    } else {
        res.json({ success: false });
    }
});

app.post("/updateNotes", (req, res) => {

const { site, jobId, notes } = req.body;

const data = JSON.parse(fs.readFileSync(filePath));

const job = data[site].jobs.find(j => j.id === jobId);

if(job){

job.notes = notes;

fs.writeFileSync(filePath, JSON.stringify(data,null,2));

res.json({success:true});

}else{

res.json({success:false});

}

});

app.listen(PORT, () => {
    console.log(`Server running http://localhost:${PORT}`);
});
