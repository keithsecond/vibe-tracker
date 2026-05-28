const express = require("express");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = 3000;

//const filePath = path.join(__dirname, "jobs.json");
const filePath = path.join(__dirname, "../prospects/tests/jobResults.json");

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

app.post("/addJob", (req, res) => {

const { vendor, newVendor, vendorURL, id, title, date } = req.body;

const data = JSON.parse(fs.readFileSync(filePath));

let vendorKey = vendor;

/* Create new vendor if selected */

if (vendor === "NEW_VENDOR") {

if (!newVendor || !vendorURL) {
return res.json({ success:false, message:"Missing vendor info" });
}

vendorKey = newVendor;

/* Create vendor entry if it doesn't exist */

if (!data[vendorKey]) {

data[vendorKey] = {
Site: newVendor,
URL: vendorURL,
jobs: []
};

}

}

/* Ensure vendor exists */

if (!data[vendorKey]) {

return res.json({ success:false, message:"Vendor not found" });

}

/* Prevent duplicate jobs */

const exists = data[vendorKey].jobs.some(j => j.id === id);

if (exists) {

return res.json({ success:false, message:"Job already exists" });

}

/* Add job */

data[vendorKey].jobs.push({

id,
title,
status: "0",
date,
notes: ""

});

fs.writeFileSync(filePath, JSON.stringify(data,null,2));

res.json({ success:true });

});

app.get("/vendors", (req,res)=>{

const data = JSON.parse(fs.readFileSync(filePath));

const vendors = Object.keys(data)
.filter(v => v !== "Status Definitions");

res.json(vendors);

});

app.listen(PORT, () => {
    console.log(`Server running http://localhost:${PORT}`);
});
