const net = require('net');
const jimp = require('jimp');
const { Buffer } = require('buffer');
const sysInfo = require('systeminformation');
const screenshot = require('screenshot-desktop');
const { color } = require('jimp');

const handleRFBCreated = (socket) => {
    const sendSecurityHandshake = () => {
        /*
            Security Handshake
            +--------+--------------------+
            | Number | Name               |
            +--------+--------------------+
            | 0      | Invalid            |
            | 1      | None               |
            | 2      | VNC Authentication |
            +--------+--------------------+

            If we transmit security byte as 0, It means the server does not agree
            to the client's RFB Protocol during negotiation. Also, in this case a
            reason needs to be sent and the connection needs to be closed.
        */

        socket.write(Buffer.from([0x01, 0x01]), () => {
            socket.once('data', (selectedSecurityMethod) => {
                console.log("Received Selected Security Method. Proceeding to Security Result Handshake.")
                sendSecurityResultHandshake();
            })
        });
    }

    const sendSecurityResultHandshake = () => {
        /*
            The server sends a word to inform the client whether the security
            handshaking was successful.

           +--------------+--------------+-------------+
           | No. of bytes | Type [Value] | Description |
           +--------------+--------------+-------------+
           | 4            | U32          | status:     |
           |              | 0            | OK          |
           |              | 1            | failed      |
           +--------------+--------------+-------------+ 
           
           We continue directly to ClientInit (shared-flag) as we no authentication
           method was chosen
        */

        let SECURITY_RESULT = Buffer.allocUnsafe(4);
        SECURITY_RESULT.writeUInt32LE(0x00, 0);

        socket.write(SECURITY_RESULT, () => {
            socket.once('data', (clientInitMessage) => {
                /*
                    Shared-flag is non-zero (true) if the server should try to share the
                    desktop by leaving other clients connected, and zero (false) if it
                    should give exclusive access to this client by disconnecting all
                    other clients.                
                */

                console.log("Received ClientInit Message. Proceeding to ServerInit Handshake.")
                sendServerInitMessage()
            })
        });
    }

    const sendServerInitMessage = () => {
        let
            BITS_PER_PIXEL,     /* 1BYTE, UINT8 */
            DEPTH,              /* 1BYTE, UINT8 */
            BIG_ENDIAN_FLAG,    /* 1BYTE, UINT8 */
            TRUE_COLOR_FLAG,    /* 1BYTE, UINT8 */
            RED_MAX,            /* 2BYTE, UIN16 */
            GREEN_MAX,          /* 2BYTE, UIN16 */
            BLUE_MAX,           /* 2BYTE, UIN16 */
            RED_SHIFT,          /* 1BYTE, UINT8 */
            GREEN_SHIFT,        /* 1BYTE, UINT8 */
            BLUE_SHIFT,         /* 1BYTE, UINT8 */
            PADDING;            /* 3BYTE, ----- */

        let
            FRAMEBUFFER_WIDTH,  /* 2BYTE, UINT16 */
            FRAMEBUFFER_HEIGHT, /* 2BYTE, UINT16 */
            PIXEL_FORMAT,       /* 16BYT, PIX_FR */
            NAME_LENGTH,        /* 4BYTE, UINT32 */
            NAME_STRING;        /* NAM_L, UI8ARR */

        let ALLOWED_BITS_PER_PIXEL = [8, 16, 32];
        let SERVER_INIT_MESSAGE;

        /* Allocating Buffer Memory Locations */
        BITS_PER_PIXEL = Buffer.allocUnsafe(1);
        DEPTH = Buffer.allocUnsafe(1);
        BIG_ENDIAN_FLAG = Buffer.allocUnsafe(1);
        TRUE_COLOR_FLAG = Buffer.allocUnsafe(1);
        RED_MAX = Buffer.allocUnsafe(2);
        GREEN_MAX = Buffer.allocUnsafe(2);
        BLUE_MAX = Buffer.allocUnsafe(2);
        RED_SHIFT = Buffer.allocUnsafe(1);
        GREEN_SHIFT = Buffer.allocUnsafe(1);
        BLUE_SHIFT = Buffer.allocUnsafe(1);
        PADDING = Buffer.allocUnsafe(3);
        FRAMEBUFFER_WIDTH = Buffer.allocUnsafe(2);
        FRAMEBUFFER_HEIGHT = Buffer.allocUnsafe(2);
        PIXEL_FORMAT = Buffer.allocUnsafe(16);
        NAME_LENGTH = Buffer.allocUnsafe(4);
        NAME_STRING = Buffer.allocUnsafe(16);
        SERVER_INIT_MESSAGE = Buffer.allocUnsafe(32);

        const processNearestBPS = (CURRENT_PIXEL_DEPTH, callback) => {
            let SELECTED_BIT_PER_PIXEL = 8;
            let ITER_BIT_PXL_STORE = [];
            let callbackComplete = false;

            const doCallback = () => {
                callback(SELECTED_BIT_PER_PIXEL);
                callbackComplete = true;
            }

            ALLOWED_BITS_PER_PIXEL.forEach((BIT_PER_PIXEL) => {
                if (BIT_PER_PIXEL == CURRENT_PIXEL_DEPTH) {
                    SELECTED_BIT_PER_PIXEL = BIT_PER_PIXEL;
                    doCallback();
                } else if (BIT_PER_PIXEL < CURRENT_PIXEL_DEPTH) {
                    ITER_BIT_PXL_STORE.push(BIT_PER_PIXEL);
                }
            });

            if (callbackComplete == false) {
                SELECTED_BIT_PER_PIXEL = (ITER_BIT_PXL_STORE.length > 0) ? ITER_BIT_PXL_STORE.pop() : SELECTED_BIT_PER_PIXEL;
                doCallback();
            }
        }

        sysInfo.graphics((graphicsInformation) => {
            let selectedDisplay = graphicsInformation.displays[0];
            processNearestBPS(selectedDisplay.pixelDepth, (SELECTED_BIT_PER_PIXEL) => {
                BITS_PER_PIXEL.writeUInt8((SELECTED_BIT_PER_PIXEL), 0)
                DEPTH.writeUInt8(selectedDisplay.pixelDepth, 0);
                BIG_ENDIAN_FLAG.writeUInt8(0x01, 0);
                TRUE_COLOR_FLAG.writeUInt8(0x01, 0);
                RED_MAX.writeUInt16BE(65535, 0);
                GREEN_MAX.writeUInt16BE(65535, 0);
                BLUE_MAX.writeUInt16BE(65535, 0);
                RED_SHIFT.writeUInt8(0x04, 0);
                GREEN_SHIFT.writeUInt8(0x02, 0);
                BLUE_SHIFT.writeUInt8(0x00, 0);
                PADDING.writeUInt8(0x00, 0);

                PIXEL_FORMAT = Buffer.concat([
                    BITS_PER_PIXEL,
                    DEPTH,
                    BIG_ENDIAN_FLAG,
                    TRUE_COLOR_FLAG,
                    RED_MAX,
                    GREEN_MAX,
                    BLUE_MAX,
                    RED_SHIFT,
                    GREEN_SHIFT,
                    BLUE_SHIFT,
                    PADDING
                ], 16);

                FRAMEBUFFER_WIDTH.writeUInt16BE(selectedDisplay.currentResX, 0);
                FRAMEBUFFER_HEIGHT.writeUInt16BE(selectedDisplay.currentResY, 0);
                NAME_LENGTH.writeUInt32BE(8, 0);
                NAME_STRING.writeUInt8("SPIFYRFB", 0);

                SERVER_INIT_MESSAGE = Buffer.concat([
                    FRAMEBUFFER_WIDTH,
                    FRAMEBUFFER_HEIGHT,
                    PIXEL_FORMAT,
                    NAME_LENGTH,
                    new TextEncoder().encode("SPIFYRFB")
                ]);

                socket.write(SERVER_INIT_MESSAGE, () => {
                    socket.on('data', (CLIENT_COM) => {
                        let MESSAGE_TYPE;
                        MESSAGE_TYPE = Buffer.allocUnsafe(1);
                        CLIENT_COM.copy(MESSAGE_TYPE, 0, 0, 1);

                        const parsePixelFormatMessage = () => {
                            //CLIENT_COM.copy(PIXEL_FORMAT, 0, 4);
                        }

                        const parseSetEncodingMessage = () => {

                        }

                        const parseFrameBufferUpdateMessage = () => {
                            let
                                INCREMENTAL,
                                X_POSITION,
                                Y_POSITION,
                                WIDTH,
                                HEIGHT;

                            INCREMENTAL = Buffer.allocUnsafe(1);
                            X_POSITION = Buffer.allocUnsafe(2);
                            Y_POSITION = Buffer.allocUnsafe(2);
                            WIDTH = Buffer.allocUnsafe(2);
                            HEIGHT = Buffer.allocUnsafe(2);

                            CLIENT_COM.copy(INCREMENTAL, 0, 1, 2);
                            CLIENT_COM.copy(X_POSITION, 0, 2, 4);
                            CLIENT_COM.copy(Y_POSITION, 0, 4, 6);
                            CLIENT_COM.copy(WIDTH, 0, 6, 8);
                            CLIENT_COM.copy(HEIGHT, 0, 8, 10);

                            /*
                                Frame Buffer Update Header:
                                +--------------+--------------+----------------------+
                                | No. of bytes | Type [Value] | Description          |
                                +--------------+--------------+----------------------+
                                | 1            | U8 [0]       | message-type         |
                                | 1            |              | padding              |
                                | 2            | U16          | number-of-rectangles |
                                +--------------+--------------+----------------------+                            

                                Followed By Update Content:
                                +--------------+--------------+---------------+
                                | No. of bytes | Type [Value] | Description   |
                                +--------------+--------------+---------------+
                                | 2            | U16          | x-position    |
                                | 2            | U16          | y-position    |
                                | 2            | U16          | width         |
                                | 2            | U16          | height        |
                                | 4            | S32          | encoding-type |
                                +--------------+--------------+---------------+
                                
                                RFB Implementations demonstrate passing the Frame Buffer Data
                                After all the above information as PIXEL_DATA in Chosen Encod
                                -ing format.

                                Value Encoding Type S32 indicates a Signed 32bit Integer Value.
                            */

                            let
                                UPDATE_MESSAGE_TYPE,
                                UPDATE_PADDING,
                                UPDATE_RECT_COUNT,
                                UPDATE_ENCODING_TYPE;

                            UPDATE_MESSAGE_TYPE = Buffer.allocUnsafe(1);
                            UPDATE_PADDING = Buffer.allocUnsafe(1);
                            UPDATE_RECT_COUNT = Buffer.allocUnsafe(2);
                            UPDATE_ENCODING_TYPE = Buffer.allocUnsafe(4);

                            UPDATE_MESSAGE_TYPE.writeUInt8(0x00, 0);
                            UPDATE_PADDING.writeUInt8(0x00, 0);
                            UPDATE_RECT_COUNT.writeUint16BE(0x01, 0); /* Change to Number of Rectangles. */
                            UPDATE_ENCODING_TYPE.writeInt32BE(0x00, 0); /* ENCODING_TYPE (SET RAW) */

                            if (+INCREMENTAL.readUInt8(0).toString() == 0) {
                                screenshot().then((SC_BUFFER) => {
                                    jimp.read(SC_BUFFER, (err, JIMP_SC) => {
                                        let RGB_PIXEL_ARRAY = [];
                                        for (let vScan = 0; vScan < JIMP_SC.getHeight(); vScan++) {
                                            for (let hScan = 0; hScan < JIMP_SC.getWidth(); hScan++) {
                                                let currentColor = jimp.intToRGBA(JIMP_SC.getPixelColor(hScan, vScan));

                                                let red = currentColor.r;
                                                let green = currentColor.g;
                                                let blue = currentColor.b;

                                                let calcPixel = (red << 4) | (green << 2) | (blue << 0);

                                                RGB_PIXEL_ARRAY.push(calcPixel);
                                            }
                                        }

                                        socket.write(Buffer.concat([
                                            UPDATE_MESSAGE_TYPE,
                                            UPDATE_PADDING,
                                            UPDATE_RECT_COUNT
                                        ]));

                                        socket.write(Buffer.concat([
                                            X_POSITION,
                                            Y_POSITION,
                                            WIDTH,
                                            HEIGHT,
                                            UPDATE_ENCODING_TYPE
                                        ]));

                                        socket.write(Buffer.from(RGB_PIXEL_ARRAY));
                                        console.log("Frame Buffer Sent!");
                                    });
                                });
                            } else {

                            }
                        }

                        const parseKeyEventMessage = () => { }
                        const parsePointerEventMessage = () => { }
                        const parseClientCutTxtMessage = () => { }

                        /*
                            +--------+--------------------------+
                            | Number | Name                     |
                            +--------+--------------------------+
                            | 0      | SetPixelFormat           |
                            | 2      | SetEncodings             |
                            | 3      | FramebufferUpdateRequest |
                            | 4      | KeyEvent                 |
                            | 5      | PointerEvent             |
                            | 6      | ClientCutText            |
                            +--------+--------------------------+                        
                        */

                        console.log(`Recevied Signal ${+MESSAGE_TYPE.readUInt8(0).toString()}`);
                        switch (+MESSAGE_TYPE.readUInt8(0).toString()) {
                            case 0:
                                parsePixelFormatMessage();
                                break;
                            case 2:
                                parseSetEncodingMessage();
                                break;
                            case 3:
                                parseFrameBufferUpdateMessage();
                                break;
                            case 4:
                                parseKeyEventMessage();
                                break;
                            case 5:
                                parsePointerEventMessage();
                                break;
                            case 6:
                                parseClientCutTxtMessage();
                                break;
                            default:
                                console.log(`API for MESSAGE_TYPE ${MESSAGE_TYPE.readUInt8(0).toString()} Not Implemented.`)
                                break;
                        }
                    })
                });
            });
        });
    }

    socket.write(Buffer.from('RFB 003.008\n', 'utf8'), () => {
        socket.once('data', (SELECTED_RFB_PROTO) => {
            if (SELECTED_RFB_PROTO.toString().search("RFB 003.008") != -1) {
                console.log("RFB Protocol Agreed. Proceeding to Security Handshake.")
                sendSecurityHandshake();
            } else {
                //Unsupported Server Protocol
                socket.write(Buffer.from([0x01, 0x00]));
                socket.end();
            }
        });
    });
}

const server = net.createServer(handleRFBCreated);;

// Grab an arbitrary unused port.
server.listen(5900, () => {
    console.log('RFB Server on ', server.address());
});