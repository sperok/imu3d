
# OTA Control

## Connection Mechanism

OTA Control is governed by HID Feature Reports as both input and output to MyCato.

MyCato connects to the OTA Control using Google Chrome's WebHID API.

Data is transmitted using Auli Tech's "Packet Transfer Protocol" (PTP)

## Packet Transfer Protocol (PTP)

### Header Structure

|           | Report ID | Recipient  | "Event ID" (0xFF)           | Status | Data Length |
| --------- | --------- | ---------- | --------------------------- | ------ | ----------- |
| Structure | 1 Byte    | 1 Byte     | 1 Byte                      | 1 Byte | 2 Bytes     |
| Notes     | 06 (FR)   | 00 (local) | (7:4) Module, (3:0) Option  |        |             |

#### Report ID

This is a subsystem-handled byte that must specify the index `0x06` which is the OTA Control Feature report's index within our HID Report Descriptor

#### Recipient

This byte specifies the "fowarding" of the incoming config option. `0x00` specifies that the recipient is "Local." A non-zero value implies that the incoming config message is to be routed to a peripheral of Cato. This byte is being reserved for future Cato projects.

#### Event ID

This byte is used by nRF Desktop's configuration system. Specifying `0xFF` routes directly to Cato's dedicated OTA system.

#### Status

This byte specifies the type of the incoming or outgoing OTA message. It takes on one of the following values:

```c
enum msg_type
{
    MSG_TYPE_FIRST,     // 0 - Sent to initiate a transmission
    MSG_TYPE_MID,       // 1 - Sent to continue a multi-packet transmission
    MSG_TYPE_ACK_NRSP,  // 2 - Acknowledge receipt of complete incoming message: No response pending
    MSG_TYPE_ACK_RSP    // 3 - Acknowledge receipt of complete incoming message: Response is pending
    MSG_TYPE_NACK,      // 4 - Not Acknowledged: Incoming message invalid
    MSG_TYPE_EMPTY,     // 5 - Data Requested, but none pending
    MSG_TYPE_RESULT,    // 6 - [NOT IMPLEMENTED]: Indicate result of trigger command execution
    MSG_TYPE_COUNT      // 7 - Count number of entries in msg_type enum
};
```

#### Data Length

sys_put_le16(data_len)

| Byte 1 | Byte 2 |
| ------ | ------ |
| LSB    | MSB    |

### Response Sequence

| Incoming messages | Message Content                       | response msg_type | Type Meaning                                |
| ----------------- | ------------------------------------- | ----------------- | ------------------------------------------- |
|                   | Valid Data, but no response warranted | ACK_NRSP          | no data follows                             |
|                   | Valid Data, response warranted        | ACK_RSP           | subsequent requests will present data       |
|                   | Invalid Data                          | NACK              | Error: described in message payload         |

## Operation

The OTA parent commands are:

- `init`
  - This command is intended to be requested on first connection.
  - It is used to report Cato's current version, Peer Identity, and State
- `trigger`
  - This command is sent when a user clicks a button from MyCato's routine dispatch panel
  - It causes a preconfigured set of instructions (action[]) to be executed in sequence
- `config`
  - This command gets and sets values Cato configuration options
- `sleep`
  - Commands the device to sleep
- `reboot`
  - Commands the device to reboot
- `practice` - [Docs](https://github.com/aulitech/z_cato/wiki/HID-Reports#practice-mode---input-report---0x08)
  - `on` - enable practice mode
  - `off` - disable practice mode
- `sensor_stream` - [Docs](https://github.com/aulitech/z_cato/wiki/HID-Reports#sensor-stream---input-report---0x07)
  - `on` - enable sensor stream (for gesture collection & visualization)
  - `off` - disable sensor stream

### init

- MyCato can send `init` at any time.
- Cato will respond with relevant information in JSON Format

Response Format:

```json
{
    "peer_id": 0,
    "version": {
        "major": 0,
        "minor": 2,
        "patch": 1,
        "string": "v0.2.1-extra"
    },
    "gesture_list": [
        "names of gestures"
    ],
    "action_names": [
        "names of all supported action types of current cato version"
    ]
}
```

### trigger

The `trigger` command is used to imediately execute a provided action. This command takes one argument in the form of either an index into Catos configured `action_list` or a json blob defining a new action to be parsed and executed.

#### trigger by index

The same way actions are bound to gestures or taps, `trigger N` can be used to trigger the `N`th entry of `action_list` imediately. If `N` is out of bounds, no action will be excecuted.

#### trigger by json

If the desired action is not present or garunteed to be present in `action_list`, a full json formatted action defenition can be provided as the agrument for the `trigger` action. For info on how to define new actions see the [Action Configuration Guide](https://github.com/aulitech/z_cato/wiki/Action-Configuration).

Below is a sample OTA `trigger` command for tapping the left mouse button:\
`trigger {"command":"button_action", "args":[0,"tap",1]}`

### config

#### Reference JSON

The following "sample" JSON is referenced in examples throughout the `config` section:

```json
{
  "a":true,
  "b":{
    "c":"string",
    "d":[1,2,3]
  }
}
```

#### Config Subcommands

- `get <path>`
  - sends config subtree at specified path
- `set <path> <blob>`
  - sets value of config subtree at specified path to json specified by blob
  - json blob to be sent is the subtree with its root at path
  - Deletion to be handled by setting node.value = null, which will delete the containing key, as well.
  - Sample Deletions
    - `Delete SampleJSON["b"]["d"]`
      - MyCato sends `set /b/d null`
      - results in deletion of node `d`; node b is as follows `{"b": {"c": "string"}}`
    - `Delete SampleJSON["b"]["d"][2]`
      - `set /b/d/2 null`
      - results in the array at `"d"` having a new value of `[1, 2]`
- `save`
  - current active config is written to persistent memory
- `revert`
  - current active config is discarded in favor of last saved config (NVS).

#### Specifying Path

A given path obeys the following convention:

- The path begins with `/` to indicate the root of the tree
  - e.g. `/` is a valid path specifying the entire json
- json keys are specified without quotes
  - e.g. `/a` specifies `true`
- The path is not slash-terminated.
  - e.g. `/a/` is invalid
- Arrays are accessed as standard objects
  - e.g. `/b/d` indicates the entire array `[1, 2, 3]`
  - Array items are accessed by treating the index as a key, since cJSON is type-aware of its own elements
    - e.g. `/b/d/2` is a valid path specifying `3`

#### Specifying JSON Blob

When setting a value, the entire string representation of the JSON subtree to be assigned must be provided.

For example, to set our sample JSON's `"b"` node, MyCato would send:

- `config set /b {"c":"some new value", "d":[4,5,6]}`
  - Note that the string value for `"c"` is quoted, as that is the json representation of a string.

When setting a single value, the full subtree is simply that value

For example, to set our sample JSON's `"a"` node, MyCato would send:

- `config set /a false`
  - Note that `false` is not quoted, because the json representation of a bool is not quoted

### reboot

Immediately reboot cato

### sleep

Cato enters low-power mode and sets up motion wake

- Proposed Children (not implemented)
  - `button`
    - wake Cato with a button press
  - `motion`
    - wake Cato with significant motion (shake head)
  - `tap`
    - wake Cato only when detecting a tap
    - `<type>` which tap type (single | double) wakes the device
