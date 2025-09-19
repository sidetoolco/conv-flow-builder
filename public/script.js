let selectedFiles = [];
let currentFlowData = null;

mermaid.initialize({
    startOnLoad: true,
    theme: 'default',
    flowchart: {
        useMaxWidth: true,
        htmlLabels: true,
        curve: 'basis'
    }
});

const uploadArea = document.getElementById('uploadArea');
const fileInput = document.getElementById('fileInput');
const browseBtn = document.getElementById('browseBtn');
const fileList = document.getElementById('fileList');
const processBtn = document.getElementById('processBtn');
const resultsSection = document.getElementById('resultsSection');
const loading = document.getElementById('loading');

uploadArea.addEventListener('click', () => fileInput.click());
browseBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    fileInput.click();
});

uploadArea.addEventListener('dragover', (e) => {
    e.preventDefault();
    uploadArea.classList.add('dragover');
});

uploadArea.addEventListener('dragleave', () => {
    uploadArea.classList.remove('dragover');
});

uploadArea.addEventListener('drop', (e) => {
    e.preventDefault();
    uploadArea.classList.remove('dragover');
    handleFiles(e.dataTransfer.files);
});

fileInput.addEventListener('change', (e) => {
    handleFiles(e.target.files);
});

function handleFiles(files) {
    const audioFiles = Array.from(files).filter(file => file.type.startsWith('audio/'));

    if (audioFiles.length === 0) {
        alert('Please select audio files only');
        return;
    }

    if (selectedFiles.length + audioFiles.length > 10) {
        alert('Maximum 10 files allowed');
        return;
    }

    selectedFiles = [...selectedFiles, ...audioFiles];
    updateFileList();
}

function updateFileList() {
    fileList.innerHTML = '';

    selectedFiles.forEach((file, index) => {
        const fileItem = document.createElement('div');
        fileItem.className = 'file-item';
        fileItem.innerHTML = `
            <span>${file.name} (${(file.size / 1024 / 1024).toFixed(2)} MB)</span>
            <button class="remove-file" data-index="${index}">Remove</button>
        `;
        fileList.appendChild(fileItem);
    });

    document.querySelectorAll('.remove-file').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const index = parseInt(e.target.dataset.index);
            selectedFiles.splice(index, 1);
            updateFileList();
        });
    });

    processBtn.disabled = selectedFiles.length === 0;
}

processBtn.addEventListener('click', async () => {
    if (selectedFiles.length === 0) return;

    const formData = new FormData();
    selectedFiles.forEach(file => {
        formData.append('audioFiles', file);
    });

    loading.style.display = 'flex';
    processBtn.disabled = true;

    try {
        const response = await fetch('/api/upload', {
            method: 'POST',
            body: formData
        });

        const data = await response.json();

        if (data.success) {
            currentFlowData = data;
            displayResults(data);
            resultsSection.style.display = 'block';
            resultsSection.scrollIntoView({ behavior: 'smooth' });
        } else {
            alert('Error: ' + data.error);
        }
    } catch (error) {
        alert('Error processing files: ' + error.message);
    } finally {
        loading.style.display = 'none';
        processBtn.disabled = false;
    }
});

function displayResults(data) {
    displayDiagram(data.flowData.mermaidDiagram);
    displayPrompts(data.flowData);
    displayTranscript(data.transcriptions);
}

function displayDiagram(mermaidCode) {
    const container = document.getElementById('mermaidDiagram');
    container.innerHTML = '';

    try {
        const graphDiv = document.createElement('div');
        graphDiv.className = 'mermaid';
        graphDiv.textContent = mermaidCode;
        container.appendChild(graphDiv);

        mermaid.init(undefined, graphDiv);
    } catch (error) {
        console.error('Mermaid diagram error:', error);
        container.innerHTML = `
            <div style="color: red; padding: 20px;">
                <h4>Error generating diagram</h4>
                <p>There was an issue with the diagram syntax. Please try again.</p>
                <details>
                    <summary>Debug Info</summary>
                    <pre>${mermaidCode}</pre>
                </details>
            </div>
        `;
    }
}

function displayPrompts(flowData) {
    const container = document.getElementById('promptsContainer');
    container.innerHTML = '';

    flowData.nodes.forEach(node => {
        const promptCard = document.createElement('div');
        promptCard.className = 'prompt-card';

        const prompt = flowData.prompts[node.id] || 'No prompt available';

        promptCard.innerHTML = `
            <h4>${node.id}</h4>
            <span class="node-type">${node.type}</span>
            <div class="prompt-text">${prompt}</div>
        `;

        container.appendChild(promptCard);
    });
}

function displayTranscript(transcriptions) {
    const container = document.getElementById('transcriptContainer');
    container.innerHTML = '';

    transcriptions.forEach(transcript => {
        const section = document.createElement('div');
        const langBadge = transcript.language === 'es' ? '🇪🇸 Spanish' : '🇬🇧 English';
        section.innerHTML = `
            <h3>${transcript.filename} <span style="font-size: 0.8em; color: #667eea;">${langBadge}</span></h3>
        `;

        transcript.utterances.forEach(utterance => {
            const utteranceDiv = document.createElement('div');
            utteranceDiv.className = 'utterance';
            utteranceDiv.innerHTML = `
                <div class="speaker-label">Speaker ${utterance.speaker}</div>
                <div>${utterance.text}</div>
            `;
            section.appendChild(utteranceDiv);
        });

        container.appendChild(section);
    });
}

document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');

        const tabName = btn.dataset.tab;
        document.querySelectorAll('.tab-content').forEach(content => {
            content.style.display = 'none';
        });
        document.getElementById(`${tabName}Tab`).style.display = 'block';
    });
});

document.getElementById('exportDiagram').addEventListener('click', () => {
    if (!currentFlowData) return;

    const blob = new Blob([currentFlowData.flowData.mermaidDiagram], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'conversation-flow.mmd';
    a.click();
    URL.revokeObjectURL(url);
});

document.getElementById('exportPrompts').addEventListener('click', () => {
    if (!currentFlowData) return;

    const prompts = {
        nodes: currentFlowData.flowData.nodes,
        prompts: currentFlowData.flowData.prompts,
        edges: currentFlowData.flowData.edges
    };

    const blob = new Blob([JSON.stringify(prompts, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'voice-agent-prompts.json';
    a.click();
    URL.revokeObjectURL(url);
});

// PDF Export for Diagram
document.getElementById('exportDiagramPDF').addEventListener('click', async () => {
    if (!currentFlowData) return;

    const { jsPDF } = window.jspdf;
    const diagramContainer = document.getElementById('mermaidDiagram');

    try {
        const canvas = await html2canvas(diagramContainer, {
            scale: 2,
            backgroundColor: '#ffffff'
        });

        const imgData = canvas.toDataURL('image/png');
        const pdf = new jsPDF({
            orientation: 'landscape',
            unit: 'px',
            format: [canvas.width, canvas.height]
        });

        pdf.addImage(imgData, 'PNG', 0, 0, canvas.width, canvas.height);
        pdf.save('conversation-flow-diagram.pdf');
    } catch (error) {
        console.error('Error generating PDF:', error);
        alert('Error generating PDF. Please try again.');
    }
});

// PDF Export for Prompts
document.getElementById('exportPromptsPDF').addEventListener('click', () => {
    if (!currentFlowData) return;

    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF();

    // Add title
    pdf.setFontSize(20);
    pdf.text('Voice Agent Conversation Flow', 20, 20);

    pdf.setFontSize(12);
    let yPos = 40;
    const lineHeight = 7;
    const pageHeight = pdf.internal.pageSize.height;
    const margin = 20;

    // Add nodes and prompts
    currentFlowData.flowData.nodes.forEach((node, index) => {
        // Check if we need a new page
        if (yPos > pageHeight - 40) {
            pdf.addPage();
            yPos = 20;
        }

        // Node header
        pdf.setFont(undefined, 'bold');
        pdf.text(`Node ${index + 1}: ${node.id}`, margin, yPos);
        yPos += lineHeight;

        pdf.setFont(undefined, 'normal');
        pdf.text(`Type: ${node.type}`, margin + 10, yPos);
        yPos += lineHeight;

        // Content
        const content = node.content || 'No content';
        const contentLines = pdf.splitTextToSize(`Content: ${content}`, pdf.internal.pageSize.width - 40);
        contentLines.forEach(line => {
            if (yPos > pageHeight - 20) {
                pdf.addPage();
                yPos = 20;
            }
            pdf.text(line, margin + 10, yPos);
            yPos += lineHeight;
        });

        // Prompt
        const prompt = currentFlowData.flowData.prompts[node.id] || 'No prompt available';
        const promptLines = pdf.splitTextToSize(`Prompt: ${prompt}`, pdf.internal.pageSize.width - 40);
        promptLines.forEach(line => {
            if (yPos > pageHeight - 20) {
                pdf.addPage();
                yPos = 20;
            }
            pdf.text(line, margin + 10, yPos);
            yPos += lineHeight;
        });

        yPos += lineHeight; // Extra space between nodes
    });

    // Add edges on a new page
    pdf.addPage();
    pdf.setFontSize(16);
    pdf.text('Conversation Flow Connections', margin, 20);
    yPos = 35;

    pdf.setFontSize(12);
    currentFlowData.flowData.edges.forEach(edge => {
        if (yPos > pageHeight - 20) {
            pdf.addPage();
            yPos = 20;
        }
        pdf.text(`${edge.from} → ${edge.to}`, margin, yPos);
        yPos += lineHeight;
    });

    pdf.save('voice-agent-prompts.pdf');
});