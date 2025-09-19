let selectedFiles = [];
let currentFlowData = null;

mermaid.initialize({
    startOnLoad: true,
    theme: 'neutral',
    flowchart: {
        useMaxWidth: true,
        htmlLabels: true,
        curve: 'linear'
    },
    themeVariables: {
        primaryColor: '#ffffff',
        primaryTextColor: '#000000',
        primaryBorderColor: '#000000',
        lineColor: '#333333',
        background: '#ffffff',
        mainBkg: '#ffffff',
        secondaryColor: '#f8f8f8',
        tertiaryColor: '#eeeeee'
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

    // Check file sizes
    const MAX_FILE_SIZE = 25 * 1024 * 1024; // 25MB per file for safety on Vercel
    const oversizedFiles = audioFiles.filter(file => file.size > MAX_FILE_SIZE);

    if (oversizedFiles.length > 0) {
        const names = oversizedFiles.map(f => `${f.name} (${(f.size / 1024 / 1024).toFixed(2)} MB)`).join(', ');
        alert(`Files too large (max 25MB each): ${names}\n\nPlease compress or trim your audio files.`);
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

    // Check total size before upload
    const totalSize = selectedFiles.reduce((sum, file) => sum + file.size, 0);
    const maxTotalSize = 40 * 1024 * 1024; // 40MB total for all files

    if (totalSize > maxTotalSize) {
        alert(`Total file size too large: ${(totalSize / 1024 / 1024).toFixed(2)} MB\n\nMaximum total size is 40MB. Please use fewer or smaller files.`);
        return;
    }

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

        // Check if response is OK before trying to parse JSON
        if (!response.ok) {
            const errorText = await response.text();
            console.error('Server error:', response.status, errorText);

            // Check if it's a JSON error response
            try {
                const errorData = JSON.parse(errorText);
                alert('Error: ' + (errorData.error || errorData.message || 'Server error'));
            } catch (e) {
                // If not JSON, show the raw error
                alert('Server error: ' + errorText.substring(0, 100));
            }
            return;
        }

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
        console.error('Error details:', error);
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

async function displayDiagram(mermaidCode) {
    const container = document.getElementById('mermaidDiagram');
    container.innerHTML = '';

    // Log the diagram for debugging
    console.log('Attempting to render enhanced Mermaid diagram:', mermaidCode);

    try {
        // Create a unique ID for this diagram
        const diagramId = 'mermaid-' + Date.now();

        // Create the mermaid container
        const graphDiv = document.createElement('div');
        graphDiv.id = diagramId;
        graphDiv.className = 'mermaid';
        graphDiv.textContent = mermaidCode;
        container.appendChild(graphDiv);

        // Re-initialize mermaid with monochrome settings
        await mermaid.initialize({
            startOnLoad: true,
            theme: 'neutral',
            flowchart: {
                useMaxWidth: true,
                htmlLabels: true,
                curve: 'linear',
                padding: 15
            },
            themeVariables: {
                primaryColor: '#ffffff',
                primaryTextColor: '#000000',
                primaryBorderColor: '#000000',
                lineColor: '#333333',
                background: '#ffffff',
                mainBkg: '#ffffff',
                secondaryColor: '#f8f8f8',
                tertiaryColor: '#eeeeee'
            }
        });

        await mermaid.run({
            querySelector: `#${diagramId}`,
            suppressErrors: false
        });

    } catch (error) {
        console.error('Mermaid rendering error:', error);
        console.error('Problematic diagram:', mermaidCode);

        // Try fallback with simpler rendering
        try {
            container.innerHTML = '';
            const fallbackDiv = document.createElement('div');
            fallbackDiv.className = 'mermaid';
            fallbackDiv.textContent = mermaidCode.replace(/<br\/>/g, ' ').replace(/<small>/g, '').replace(/<\/small>/g, '');
            container.appendChild(fallbackDiv);
            await mermaid.contentLoaded();
        } catch (fallbackError) {
            // Show a user-friendly error message
            container.innerHTML = `
                <div style="padding: 40px; text-align: center;">
                    <h4 style="color: #667eea; margin-bottom: 20px;">Flow Diagram Generation Issue</h4>
                    <p style="color: #64748b; margin-bottom: 20px;">
                        The conversation flow is complex. View the detailed prompts in the Agent Prompts tab for complete information.
                    </p>
                    <p style="color: #94a3b8; font-size: 0.9rem;">
                        The Agent Prompts tab contains all the voice AI agent instructions extracted from your conversation.
                    </p>
                    <details style="margin-top: 30px; text-align: left; background: #f8fafc; padding: 20px; border-radius: 8px;">
                        <summary style="cursor: pointer; color: #667eea; font-weight: 600;">Technical Details</summary>
                        <pre style="margin-top: 10px; overflow-x: auto; font-size: 0.8rem; color: #475569;">${mermaidCode}</pre>
                        <pre style="color: #ef4444; font-size: 0.8rem; margin-top: 10px;">${error.message || error}</pre>
                    </details>
                </div>
            `;
        }
    }
}

function displayPrompts(flowData) {
    const container = document.getElementById('promptsContainer');
    container.innerHTML = '';

    // Add global instructions if available
    if (flowData.globalInstructions) {
        const globalCard = document.createElement('div');
        globalCard.className = 'prompt-card global-instructions';
        globalCard.innerHTML = `
            <h4>🎯 Global Agent Instructions</h4>
            <div class="prompt-text">${flowData.globalInstructions}</div>
        `;
        container.appendChild(globalCard);
    }

    // Add error handling instructions if available
    if (flowData.errorHandling) {
        const errorCard = document.createElement('div');
        errorCard.className = 'prompt-card error-handling';
        errorCard.innerHTML = `
            <h4>⚠️ Error Handling</h4>
            <div class="prompt-text">${flowData.errorHandling}</div>
        `;
        container.appendChild(errorCard);
    }

    // Display each node with comprehensive details
    flowData.nodes.forEach((node, index) => {
        const promptCard = document.createElement('div');
        promptCard.className = `prompt-card node-type-${node.type || 'default'}`;

        // Get the full prompt or fallback to old format
        const fullPrompt = node.fullPrompt || flowData.prompts?.[node.id] || 'No prompt available';
        const examples = node.examples || [];
        const listenFor = node.listenFor || [];
        const nextActions = node.nextActions || {};

        let nextActionsHtml = '';
        if (Object.keys(nextActions).length > 0) {
            nextActionsHtml = `
                <div class="next-actions">
                    <strong>Next Actions:</strong>
                    <ul>
                        ${Object.entries(nextActions).map(([condition, target]) =>
                            `<li>${condition} → ${target}</li>`
                        ).join('')}
                    </ul>
                </div>
            `;
        }

        let examplesHtml = '';
        if (examples.length > 0) {
            examplesHtml = `
                <div class="examples">
                    <strong>Example Phrases:</strong>
                    <ul>${examples.map(ex => `<li>"${ex}"</li>`).join('')}</ul>
                </div>
            `;
        }

        let listenForHtml = '';
        if (listenFor.length > 0) {
            listenForHtml = `
                <div class="listen-for">
                    <strong>Listen For:</strong>
                    <ul>${listenFor.map(kw => `<li>${kw}</li>`).join('')}</ul>
                </div>
            `;
        }

        promptCard.innerHTML = `
            <div class="prompt-header">
                <h4>Step ${index + 1}: ${node.content || node.id}</h4>
                <span class="node-type">${node.type || 'action'}</span>
                <span class="speaker-badge">${node.speaker || 'agent'}</span>
            </div>
            <div class="prompt-text">${fullPrompt}</div>
            ${examplesHtml}
            ${listenForHtml}
            ${nextActionsHtml}
            ${node.timeout ? `<div class="timeout"><strong>Timeout:</strong> ${node.timeout} seconds</div>` : ''}
            ${node.retryPrompt ? `<div class="retry"><strong>Retry:</strong> "${node.retryPrompt}"</div>` : ''}
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