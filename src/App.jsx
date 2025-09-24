import React, { useCallback, useEffect, useRef, useState } from "react";
import ReactFlow, {
    ReactFlowProvider,
    addEdge,
    Background,
    Controls,
    ControlButton,
    MiniMap,
    useNodesState,
    useEdgesState,
    useReactFlow,   
    applyNodeChanges,
    applyEdgeChanges 
} from "reactflow";
import * as Y from "yjs";
import { WebsocketProvider } from "y-websocket";
import { nanoid } from "nanoid";
import "reactflow/dist/style.css";

function FlowCanvas({ room, connectedRoom, clientId, initRoom }) {
    // Data
    const { project } = useReactFlow();
    const applyingRemote = useRef(false);
    const [nodes, setNodes, onNodesChange] = useNodesState([]);
    const [edges, setEdges, onEdgesChange] = useEdgesState([]);
    const ydocRef = useRef(null);
    const providerRef = useRef(null);
    const yNodesRef = useRef(null);
    const yEdgesRef = useRef(null);

    // Selected node details
    const [editingNode, setEditingNode] = useState(null);
    const [form, setForm] = useState({ label: "", color: "" });

    // Toast pop-up
    const [toast, setToast] = useState("");
    const [showToast, setShowToast] = useState(false);

    // Initialize Yjs room with Redis backend
    useEffect(() => {
        async function startRoom() {
        // Clean up old doc
        if (ydocRef.current) {
            ydocRef.current.destroy();
        }
    
        const ydoc = new Y.Doc();
        const yNodes = ydoc.getArray("nodes");
        const yEdges = ydoc.getArray("edges");
    
        // Load initial state from Redis via API
        const res = await fetch(`/api/room/${room}`);
        if (!res.ok) {
            throw new Error(`Failed to fetch room: ${res.status}`);
        }
        console.log('res', res);
        const data = await res.json();
        if (data.update) {
            const update = new Uint8Array(data.update);
            Y.applyUpdate(ydoc, update);
        }
            
        // Sync Yjs + ReactFlow (your redraw function)
        const redraw = () => {
            applyingRemote.current = true;
            const plainNodes = yNodes.toArray().map((n) => JSON.parse(JSON.stringify(n)));
            const plainEdges = yEdges.toArray().map((e) => JSON.parse(JSON.stringify(e)));
            setNodes(plainNodes);
            setEdges(plainEdges);
            setTimeout(() => {
            applyingRemote.current = false;
            }, 10);
        };
        yNodes.observe(redraw);
        yEdges.observe(redraw);
    
        // Save to Redis whenever local changes happen
        ydoc.on("update", async (update) => {
            await fetch(`/api/room/${room}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ update: Array.from(update) }),
            });
        });
    
        // Poll for remote updates every 2s
        const poll = setInterval(async () => {
            const res = await fetch(`/api/room/${room}`);
            const data = await res.json();
            if (data.update) {
            const update = new Uint8Array(Object.values(data.update));
            Y.applyUpdate(ydoc, update);
            }
        }, 2000);
    
        // Save refs
        ydocRef.current = ydoc;
        yNodesRef.current = yNodes;
        yEdgesRef.current = yEdges;
    
        redraw();
    
        return () => {
            clearInterval(poll);
            ydoc.destroy();
        };
        }
    
        startRoom();
    }, [room, setNodes, setEdges]);

    const onNodesChangeWithSync = (changes) => {
        setNodes((nds) => {
            const updatedNodes = applyNodeChanges(changes, nds);
        
            if (yNodesRef.current && !applyingRemote.current) {
                ydocRef.current.transact(() => {
                changes.forEach((change) => {
                    // Only handle moved or updated nodes
                    if (change.type === 'position' || change.type === 'remove' || change.type === 'add') {
                    const index = yNodesRef.current.toArray().findIndex((n) => n.id === change.id);
                    if (index >= 0) {
                        yNodesRef.current.delete(index, 1);
                        yNodesRef.current.insert(index, [updatedNodes.find((n) => n.id === change.id)]);
                    }
                    }
                });
                });
            }
        
            return updatedNodes;
        });
    };
        
    const onEdgesChangeWithSync = (changes) => {
        setEdges((eds) => {
        const updatedEdges = applyEdgeChanges(changes, eds);
    
        if (yEdgesRef.current && !applyingRemote.current) {
            ydocRef.current.transact(() => {
            changes.forEach((change) => {
                if (change.type === 'remove' || change.type === 'add') {
                const index = yEdgesRef.current.toArray().findIndex((e) => e.id === change.id);
                if (index >= 0) {
                    yEdgesRef.current.delete(index, 1);
                    yEdgesRef.current.insert(index, [updatedEdges.find((e) => e.id === change.id)]);
                }
                }
            });
            });
        }
    
        return updatedEdges;
        });
    };

    const edgeConnect = useCallback(
        (params) => {
            const newEdge = { ...params, id: nanoid() };
            setEdges((eds) => eds.concat(newEdge));
            if (yEdgesRef.current && !applyingRemote.current) {
                ydocRef.current.transact(() => {
                    yEdgesRef.current.push([newEdge]);
                });
            }
        },
        []
    );

    // Open node details
    const openNodeDetails = useCallback((event, node) => {
        setEditingNode(node);
        setForm({
            label: node.data?.label || "",
            color: node.style?.background || "#ffffff",
            notes: node.data?.notes || "",
        });
    }, []);

    // Create new node

    const createNode = useCallback(() => {
        const viewport = {
            x: window.innerWidth / 2 - 75,
            y: window.innerHeight / 2 - 20,
        };
        const position = project(viewport);
        const id = nanoid();
        const newNode = {
            id,
            position,
            data: { label: "" },
            style: { background: "#DDC5F5", color: "#000000" },
        };
    
        setNodes((nds) => nds.concat(newNode));

        if (yNodesRef.current && !applyingRemote.current) {
            ydocRef.current.transact(() => {
                yNodesRef.current.push([newNode]);
            });
        }
    
        setToast("Created new node...");
        setShowToast(true);
        setTimeout(() => setShowToast(false), 2000);
    }, [project]);
    
    // Save changes on details modal
    const saveChanges = () => {
        setNodes((nodes) =>
            nodes.map((n) =>
                n.id === editingNode.id
                ? {
                    ...n,
                    data: { ...n.data, label: form.label, notes: form.notes },
                    style: { ...n.style, background: form.color, color: getContrastingTextColor(form.color)},
                    }
                : n
            )
        );
        setEditingNode(null);
        setToast("Saved changes...");
        setShowToast(true);
        setTimeout(() => setShowToast(false), 2000);
    };

    // Delete node
    const deleteNode = useCallback(() => {
        if (!editingNode) {
            return;
        }
        setNodes((nodes) => nodes.filter((n) => n.id !== editingNode.id));
        setEdges((edges) => edges.filter((e) => e.source !== editingNode.id && e.target !== editingNode.id));
        setEditingNode(null);
        setToast("Deleted node...");
        setShowToast(true);
        setTimeout(() => setShowToast(false), 2000);
    }, [editingNode, setNodes, setEdges]);

    // Controls node text color to contrast with background color
    function getContrastingTextColor(hex) {
        hex = hex.replace("#", "");
        const r = parseInt(hex.substr(0, 2), 16);
        const g = parseInt(hex.substr(2, 2), 16);
        const b = parseInt(hex.substr(4, 2), 16);
        const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
        return luminance > 0.6 ? "#000000" : "#ffffff";
    }

    return (
        <div>
            <div style={{ width: "100%", height: "90vh" }} >
                {/* React flow */}
                <ReactFlow
                    nodes={nodes}
                    edges={edges}
                    onNodesChange={onNodesChangeWithSync}
                    onEdgesChange={onEdgesChangeWithSync}
                    onConnect={edgeConnect}
                    onNodeClick={openNodeDetails}
                    fitView
                >
                    <Background />
                    <MiniMap
                        nodeColor={(node) => node.data?.color || node.style?.background || "#ffffff"}
                        nodeBorderRadius={5}
                        nodeStrokeColor={"#000000"}
                        zoomable
                        pannable
                        style={{ backgroundColor: "#0f172a" }}
                    />
                    <Controls>
                        {/* Add new node */}
                        <ControlButton
                            onClick={(event) => createNode(event)}
                            title="add node"
                        >
                            <svg width="800px" height="800px" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg" fillRule="#000000" className="bi bi-node-plus">
                                <path fill-rule="evenodd" d="M11 4a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM6.025 7.5a5 5 0 1 1 0 1H4A1.5 1.5 0 0 1 2.5 10h-1A1.5 1.5 0 0 1 0 8.5v-1A1.5 1.5 0 0 1 1.5 6h1A1.5 1.5 0 0 1 4 7.5h2.025zM11 5a.5.5 0 0 1 .5.5v2h2a.5.5 0 0 1 0 1h-2v2a.5.5 0 0 1-1 0v-2h-2a.5.5 0 0 1 0-1h2v-2A.5.5 0 0 1 11 5zM1.5 7a.5.5 0 0 0-.5.5v1a.5.5 0 0 0 .5.5h1a.5.5 0 0 0 .5-.5v-1a.5.5 0 0 0-.5-.5h-1z"/>
                            </svg>
                        </ControlButton>
                    </Controls>
                </ReactFlow>

                {/* Edit modal */}
                {editingNode && (
                    <div
                        style={{
                            position: "absolute",
                            top: "40%",
                            left: "50%",
                            transform: "translateX(-50%)",
                            background: "#0f172a",
                            padding: "20px",
                            borderRadius: "8px",
                            boxShadow: "0 2px 10px rgba(0,0,0,0.2)",
                            fontSize: "1.2rem",  
                        }}
                    >
                        {/* Node name */}
                        <label>
                            <input
                                style={{
                                    borderRadius: "6px",
                                    padding: "12px 16px",
                                    fontSize: "2rem",
                                    border: "1px solid #334155",
                                    background: "#0f172a",
                                    color: "white",
                                    outline: "none"
                                }}
                                placeholder="Title"
                                type="text"
                                value={form.label}
                                onChange={(e) => setForm({ ...form, label: e.target.value })}
                            />
                        </label>

                        {/* Node notes */}
                        <div style={{ marginTop: "12px" }}>
                            <textarea
                                style={{
                                    width: "100%",
                                    boxSizing: "border-box",
                                    height: "140px",
                                    borderRadius: "6px",
                                    padding: "12px 16px",
                                    fontSize: "1rem",
                                    border: "1px solid #334155",
                                    background: "#0f172a",
                                    color: "white",
                                    resize: "none",
                                    outline: "none"
                                }}
                                placeholder="Details..."
                                value={form.notes}
                                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                            />
                        </div>

                        {/* Color picker */}
                        <div>
                            <input
                                style={{
                                    width: "40px",
                                    height: "30px"
                                }}
                                type="color"
                                value={form.color}
                                onChange={(e) => setForm({ ...form, color: e.target.value })}
                            />
                        </div>

                        {/* Actions */}
                        <div
                            style={{
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "space-between",
                                marginTop: "8px"
                            }}
                        >
                            {/* Delete */}
                            <button
                                style={{
                                    paddingTop: '5px',
                                    paddingBottom: '5px',
                                    paddingLeft: '10px',
                                    paddingRight: '10px',
                                    backgroundColor: "#da2c2c",
                                    border: 'none',
                                    borderRadius: '6px',
                                    color: '#FFFFFF',
                                    marginRight: '8px',
                                    cursor: 'pointer',
                                }}
                                onClick={deleteNode}
                            >
                                DELETE
                            </button>

                            <div
                                style={{
                                    
                                }}
                            >
                                {/* Cancel */}
                                <button
                                    style={{
                                        paddingTop: '5px',
                                        paddingBottom: '5px',
                                        paddingLeft: '10px',
                                        paddingRight: '10px',
                                        backgroundColor: "#e4edf2",
                                        border: 'none',
                                        borderRadius: '6px',
                                        color: '#000000',
                                        marginRight: '8px',
                                        cursor: 'pointer',
                                    }}
                                    onClick={() => setEditingNode(null)}
                                >
                                    CANCEL
                                </button>

                                {/* Save */}
                                <button
                                    style={{
                                        paddingTop: '5px',
                                        paddingBottom: '5px',
                                        paddingLeft: '10px',
                                        paddingRight: '10px',
                                        backgroundColor: "#005b96",
                                        border: 'none',
                                        borderRadius: '6px',
                                        color: '#FFFFFF',
                                        cursor: 'pointer',
                                    }}
                                    onClick={saveChanges}
                                >
                                    SAVE
                                </button>
                            </div>
                        </div>
                    </div>
                )}

                {/* Toast */}
                {toast && (
                    <div
                        style={{
                            position: "absolute",
                            bottom: 10,
                            left: "85.5%",
                            textIndent: "left",
                            background: '#0f172a',
                            color: "#FFFFFF",
                            padding: "1px 2px",
                            boxShadow: "0 2px 10px rgba(0,0,0,0.2)",
                            zIndex: 999,
                            opacity: showToast ? 1 : 0,
                            transition: "opacity 0.5s ease-in-out"
                        }}
                    >
                        {toast}
                    </div>
                )}
            </div>
        </div>
    );
}

export default function App() {
    // Room and client initialization
    const [room, setRoom] = useState("demo-room");
    const [connectedRoom, setConnectedRoom] = useState(null);
    const [clientId] = useState(() => nanoid(6));
    const [showInfo, setShowInfo] = useState(true);

    // Path into room
    const joinRoom = () => {
        if (!room) {
            return;
        }
        setConnectedRoom(room);
    };

    // Display information
    const openInfomationDisplay = () => {
        setShowInfo(true);
    }

    // Close information display
    const closeInfomationDisplay = () => {
        setShowInfo(false);
    }

    // Sync room connection
    useEffect(() => {
        setConnectedRoom(room);
    }, []);

    return (
        <div className="app">
            {/* Header */}
            <div className="header">
                <div className="title_content">
                    {/* Title */}
                    <div className="title">
                        ARTIFACT DEMO
                    </div>
                    {/* Information button */}
                    <button
                        className="information_button"
                        onClick={openInfomationDisplay}
                    >
                        <svg height="20px" width="20px" version="1.1" id="_x32_" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 512.00 512.00" xml:space="preserve" fill="#005b96">
                            <path class="st0" d="M255.992,0.008C114.626,0.008,0,114.626,0,256s114.626,255.992,255.992,255.992 C397.391,511.992,512,397.375,512,256S397.391,0.008,255.992,0.008z M300.942,373.528c-10.355,11.492-16.29,18.322-27.467,29.007 c-16.918,16.177-36.128,20.484-51.063,4.516c-21.467-22.959,1.048-92.804,1.597-95.449c4.032-18.564,12.08-55.667,12.08-55.667 s-17.387,10.644-27.709,14.419c-7.613,2.782-16.225-0.871-18.354-8.234c-1.984-6.822-0.404-11.161,3.774-15.822 c10.354-11.484,16.289-18.314,27.467-28.999c16.934-16.185,36.128-20.483,51.063-4.524c21.467,22.959,5.628,60.732,0.064,87.497 c-0.548,2.653-13.742,63.627-13.742,63.627s17.387-10.645,27.709-14.427c7.628-2.774,16.241,0.887,18.37,8.242 C306.716,364.537,305.12,368.875,300.942,373.528z M273.169,176.123c-23.886,2.096-44.934-15.564-47.031-39.467 c-2.08-23.878,15.58-44.934,39.467-47.014c23.87-2.097,44.934,15.58,47.015,39.458 C314.716,152.979,297.039,174.043,273.169,176.123z"/>
                        </svg>
                    </button>

                    {/* Information Pop-up */}
                    {showInfo && (
                        <div className="information_popup">
                            <h1 className="information_title">🎉 Welcome to my Artifact demo! 🎉</h1>
                            <p>
                                I've had a lot of fun working on this coding project!
                                This web-app uses the React Flow library to enable users to diagram concurrently with nodes and edges. <br/><br/>
                                Concurrency Features:<br/>
                                <ul>🤝 Multiple rooms where multiple clients can access and simultaneously edit</ul>
                                Control Features:<br/>
                                <ul>🌱 Node creation (bottom-left node icon)</ul>
                                <ul>🔒 Diagram locking (lock icon)</ul>
                                <ul>🖼️ Diagram refocusing (border icon)</ul>
                                <ul>🔎 Zoom in/out (+/- icons)</ul>
                                <ul>🗺️ Interactive minimap </ul>
                                Node Features:<br/>
                                <ul>🔌 Connect nodes via edges </ul>
                                <ul>📖 Access node details (click node)</ul>
                                <ul>🤓 Name node + add details</ul>
                                <ul>🎨 Change node color + contrasting text</ul>
                                <ul>🍞 Action confirmation toasts (bottom right)</ul>

                            </p>
                            <button
                                onClick={closeInfomationDisplay}
                                className="close_information_button"
                            >
                                Close
                            </button>
                        </div>
                    )}
                </div>
                
                
                
                <div className="controls">
                    {/* Room input */}
                    <input
                        className="room_input"
                        value={room}
                        placeholder="Room..."
                        onChange={(event) => setRoom(event.target.value)}
                    />
                    <button
                        className="join_button"
                        onClick={joinRoom}
                    >
                        JOIN
                    </button>

                    {/* Room id */}
                    <div className="room_id">
                        ROOM: {connectedRoom}
                    </div>

                    {/* Client id */}
                    <div className="client_id">
                        CLIENT: {clientId}
                    </div>
                </div>
            </div>

            {/* Canvas */}
            <div className="canvas">
                <ReactFlowProvider>
                    {connectedRoom && (
                        <FlowCanvas
                            room={connectedRoom}
                            connectedRoom={connectedRoom}
                            clientId={clientId}
                        />
                    )}
                </ReactFlowProvider>
            </div>
        </div>
    );
}