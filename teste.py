import hypersync

# To see all attributes and methods of the HypersyncClient class
help(hypersync.HypersyncClient) 

# If you have an initialized client instance:
# client_config = hypersync.ClientConfig(url="YOUR_URL", bearer_token="YOUR_TOKEN")
# client = hypersync.HypersyncClient(client_config)

# print(dir(client)) # Lists all methods and attributes of the client instance
# help(client.get_height) # Shows help for the get_height method
# help(client.stream)     # Shows help for the stream method
# help(client.get)        # Shows help for the get method