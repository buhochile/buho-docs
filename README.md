<div align="center">
    <h1><b>Docmost</b></h1>
    <p>
        Open-source collaborative wiki and documentation software.
        <br />
        <a href="https://docmost.com"><strong>Website</strong></a> | 
        <a href="https://docmost.com/docs"><strong>Documentation</strong></a>
    </p>
</div>
<br />

> [!NOTE]  
> Docmost is currently in **beta**. We value your feedback as we progress towards a stable release.\
> 

## Deployment of Buho Docs

This project uses Pulumi to deploy the application to AWS. Follow the steps below to deploy the application:

### Prerequisites
    Pulumi CLI: Install the Pulumi CLI from here.
    AWS CLI: Install the AWS CLI from here.
    Node.js: Ensure you have Node.js installed. You can download it from here.

### Configuration

    AWS Credentials: Configure your AWS credentials by running aws configure and providing your AWS Access Key ID, Secret Access Key, and default region. You may need Admin Credentials.

Environment Variables: Create a .env file in the root directory of the project and populate it with the necessary environment variables. You can use the .env.example file as a reference.

## Steps to Deploy

```bash
pulumi up
```

### Cleanup

To destroy the deployed resources, run the following command:

```bash
pulumi destroy
```
>[!NOTE]
> Currently this project has only one environment deployed as *prod* stack.
>


## Getting started
To get started with Docmost, please refer to our [documentation](https://docmost.com/docs).

## Features
- Real-time collaboration
- Diagrams (Draw.io, Excalidraw and Mermaid)
- Spaces
- Permissions management
- Groups
- Comments
- Page history
- Search
- File attachment

#### Screenshots
<p align="center">
<img alt="home" src="https://docmost.com/screenshots/home.png" width="70%">
<img alt="editor" src="https://docmost.com/screenshots/editor.png" width="70%">
</p>

### Contributing 
See the [development documentation](https://docmost.com/docs/self-hosting/development)
